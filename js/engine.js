/*
 * Engine loader + UCI wrapper for real Stockfish.
 *
 * Load order:
 *   1. Local vendored engine (engine/stockfish-16.1-lite-single.js) — present on
 *      the GitHub Pages deployment (the deploy workflow downloads it) or after
 *      running engine/get-engine.sh locally.
 *   2. CDN fallback: a tiny blob worker that importScripts() Stockfish 16.1
 *      lite (single-threaded WASM) from jsdelivr, with Module.locateFile
 *      pointed at the CDN so the .wasm resolves.
 *   3. Last resort: Stockfish 10 asm.js from cdnjs (single file, runs anywhere).
 */

/*
 * Weak-play model.
 *
 * Above 1320 Stockfish's own UCI_Elo limiter is calibrated and used directly.
 * Below it we follow the approach lichess uses for its AI levels 1-5:
 * a *normal-depth* search (depth 5 — not a crippled depth-1 one) combined with
 * a low or negative Skill Level, where the engine picks among several
 * candidate moves after adding score noise that grows as skill drops.
 *
 * Classical Stockfish only accepts Skill Level 0-20; lichess gets negative
 * levels by running Fairy-Stockfish. We keep the stock engine and reproduce
 * its Skill::pick_best() formula in JS over a MultiPV list, which lets the
 * level go continuously negative.
 *
 * Elo -> Skill Level anchors come from lichess's published level calibration
 * (level 1 skill -9 ~ <400, level 2 skill -5 ~ 500, level 3 skill -1 ~ 800,
 * level 4 skill 3 ~ 1100, level 5 skill 7 ~ 1500).
 */
const WEAK_DEPTH = 5; // lichess uses depth 5 for its weak AI levels

const SKILL_ANCHORS = [
  [100, -20],
  [300, -11],
  [400, -9],
  [500, -5],
  [800, -1],
  [1100, 3],
  [1500, 7],
];

/** Continuous Elo -> Stockfish Skill Level (may be negative). */
function skillForElo(elo) {
  if (elo <= SKILL_ANCHORS[0][0]) return SKILL_ANCHORS[0][1];
  const last = SKILL_ANCHORS[SKILL_ANCHORS.length - 1];
  if (elo >= last[0]) return last[1];
  for (let i = 1; i < SKILL_ANCHORS.length; i++) {
    const [e1, s1] = SKILL_ANCHORS[i - 1];
    const [e2, s2] = SKILL_ANCHORS[i];
    if (elo <= e2) return s1 + ((elo - e1) / (e2 - e1)) * (s2 - s1);
  }
  return last[1];
}

/** How many candidate moves to consider. Weaker play needs a wider net. */
function multipvForSkill(skill) {
  return skill >= 0 ? 4 : Math.min(12, 4 + Math.round(-skill / 2));
}

/**
 * Stockfish's Skill::pick_best() formula, generalised to negative levels.
 * `ranked` is [{ move, score }] sorted best-first, scores from the mover's
 * perspective. Weaker levels add a larger deterministic *and* random bonus to
 * worse moves, so they routinely win the comparison.
 */
function pickWithSkillNoise(ranked, skill, rng = Math.random) {
  if (!ranked || !ranked.length) return null;
  const weakness = 120 - 2 * skill;
  const top = ranked[0].score;
  const delta = Math.min(top - ranked[ranked.length - 1].score, 200);
  let best = ranked[0];
  let maxScore = -Infinity;
  for (const r of ranked) {
    const push = (weakness * (top - r.score) + delta * (rng() * weakness)) / 128;
    const adjusted = r.score + push;
    if (adjusted >= maxScore) {
      maxScore = adjusted;
      best = r;
    }
  }
  return best.move;
}

const ENGINE_SOURCES = [
  {
    name: 'Stockfish 16.1 lite (local)',
    kind: 'local',
    script: 'engine/stockfish-16.1-lite-single.js',
  },
  {
    name: 'Stockfish 16.1 lite (jsDelivr)',
    kind: 'cdn-wasm',
    base: 'https://cdn.jsdelivr.net/gh/nmrugg/stockfish.js@v16.1.0/src/',
    script: 'stockfish-16.1-lite-single.js',
    wasm: 'stockfish-16.1-lite-single.wasm',
  },
  {
    name: 'Stockfish 16.1 lite (GitHub raw)',
    kind: 'cdn-wasm',
    base: 'https://raw.githubusercontent.com/nmrugg/stockfish.js/v16.1.0/src/',
    script: 'stockfish-16.1-lite-single.js',
    wasm: 'stockfish-16.1-lite-single.wasm',
  },
  {
    name: 'Stockfish 10 (CDN, asm.js)',
    kind: 'cdn-asm',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
  },
];

class SillyEngine {
  constructor() {
    this.worker = null;
    this.sourceName = null;
    this.listeners = [];
    this.lastElo = null;
    this.weakDepth = null;
    this.emulatedSkill = null;
  }

  _spawnLocal(src) {
    return new Worker(src.script);
  }

  _spawnCdn(src) {
    // Cross-origin Worker construction is blocked, but importScripts() inside a
    // same-origin blob worker is not. Stockfish.js finds its .wasm via the
    // worker URL's #hash (first comma-separated field), so we pass the CDN
    // wasm URL there.
    let shim, hash = '';
    if (src.kind === 'cdn-wasm') {
      shim = `importScripts(${JSON.stringify(src.base + src.script)});`;
      hash = '#' + encodeURIComponent(src.base + src.wasm);
    } else {
      shim = `importScripts(${JSON.stringify(src.url)});`;
    }
    const blob = new Blob([shim], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob) + hash);
  }

  _tryInit(src, timeoutMs) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = src.kind === 'local' ? this._spawnLocal(src) : this._spawnCdn(src);
      } catch (e) {
        return reject(e);
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          worker.terminate();
          reject(new Error('timeout waiting for uciok from ' + src.name));
        }
      }, timeoutMs);
      worker.onerror = (e) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(src.name + ' failed: ' + (e.message || 'worker error')));
        }
      };
      worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
        if (line.startsWith('uciok') || line.includes('uciok')) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(worker);
          }
        }
      };
      worker.postMessage('uci');
    });
  }

  async init(onStatus) {
    let lastErr = null;
    for (const src of ENGINE_SOURCES) {
      try {
        if (onStatus) onStatus('Loading ' + src.name + '…');
        this.worker = await this._tryInit(src, src.kind === 'local' ? 15000 : 25000);
        this.sourceName = src.name;
        this.worker.onerror = null;
        this.worker.onmessage = (e) => {
          const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
          for (const fn of this.listeners) fn(line);
        };
        this.send('setoption name Threads value 1');
        this.send('setoption name Hash value 32');
        return this.sourceName;
      } catch (err) {
        console.warn(err);
        lastErr = err;
      }
    }
    throw lastErr || new Error('No engine source could be loaded');
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  onLine(fn) {
    this.listeners.push(fn);
  }

  newGame() {
    this.send('ucinewgame');
    this.send('isready');
  }

  /**
   * Map an effective Elo to engine settings.
   *  - 1320..3190: Stockfish's own calibrated limiter.
   *  - below 1320:  depth-5 search with a low/negative Skill Level, as lichess
   *                 does for its weak AI levels. Non-negative skill is handled
   *                 natively; negative skill is emulated in JS over MultiPV
   *                 (see pickWithSkillNoise).
   */
  setStrength(effectiveElo) {
    const elo = Math.round(effectiveElo);
    if (elo === this.lastElo) return;
    this.lastElo = elo;

    if (elo >= 1320) {
      this.weakDepth = null;
      this.emulatedSkill = null;
      this.send('setoption name MultiPV value 1');
      this.send('setoption name Skill Level value 20');
      this.send('setoption name UCI_LimitStrength value true');
      this.send('setoption name UCI_Elo value ' + Math.min(3190, elo));
      return;
    }

    const skill = skillForElo(elo);
    this.weakDepth = WEAK_DEPTH;
    this.send('setoption name UCI_LimitStrength value false');
    if (skill >= 0) {
      // Stock engine can do this itself.
      this.emulatedSkill = null;
      this.send('setoption name MultiPV value 1');
      this.send('setoption name Skill Level value ' + Math.round(skill));
    } else {
      // Below skill 0: search honestly, then choose badly on purpose.
      this.emulatedSkill = skill;
      this.send('setoption name Skill Level value 20');
    }
  }

  /** Full strength, no limiter — used for post-game analysis. */
  setFullStrength() {
    this.lastElo = null; // force reconfiguration for the next game
    this.weakDepth = null;
    this.send('setoption name UCI_LimitStrength value false');
    this.send('setoption name Skill Level value 20');
  }

  /**
   * Evaluate a position at fixed depth.
   * Resolves { cp, mate, best } where cp/mate are from the side-to-move's
   * perspective and best is the engine's preferred move in UCI notation.
   */
  evaluate(fen, depth) {
    return new Promise((resolve) => {
      let cp = 0;
      let mate = null;
      const handler = (line) => {
        if (line.startsWith('info') && line.includes(' score ')) {
          const m = line.match(/ score (cp|mate) (-?\d+)/);
          if (m) {
            if (m[1] === 'cp') {
              cp = parseInt(m[2], 10);
              mate = null;
            } else {
              mate = parseInt(m[2], 10);
              cp = mate > 0 ? 10000 : -10000;
            }
          }
        } else if (line.startsWith('bestmove')) {
          this.listeners = this.listeners.filter((f) => f !== handler);
          resolve({ cp, mate, best: line.split(/\s+/)[1] });
        }
      };
      this.onLine(handler);
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
    });
  }

  /**
   * Rank every legal move with a MultiPV search, best first.
   * Used by PityFish (worst move) and DrawFish (most equal move). Runs at
   * full strength — the limiter randomizes move choice, which would distort
   * the ranking — and restores single-PV settings afterwards.
   * Resolves an array of { move, score } sorted descending by score (from
   * the side-to-move's perspective), or null if unavailable.
   */
  async rankMoves(fen, legalCount, depth) {
    if (!legalCount) return null;
    const ranked = await this._rankFrom(fen, Math.min(250, legalCount), depth);
    this.lastElo = null; // caller's strength settings were disturbed
    return ranked;
  }

  /** Shared MultiPV ranking. Leaves MultiPV back at 1. */
  async _rankFrom(fen, multipv, depth) {
    this.send('setoption name UCI_LimitStrength value false');
    this.send('setoption name Skill Level value 20');
    this.send('setoption name MultiPV value ' + multipv);

    const lines = new Map(); // multipv index -> { move, score, depth }
    const result = await new Promise((resolve) => {
      const re = /\bdepth (\d+)\b.*?\bmultipv (\d+)\b.*?\bscore (cp|mate) (-?\d+).*?\bpv (\S+)/;
      const handler = (line) => {
        if (line.startsWith('info')) {
          const m = line.match(re);
          if (m) {
            const d = parseInt(m[1], 10);
            const idx = parseInt(m[2], 10);
            const score =
              m[3] === 'cp'
                ? parseInt(m[4], 10)
                : parseInt(m[4], 10) > 0
                  ? 100000 - parseInt(m[4], 10)
                  : -100000 - parseInt(m[4], 10);
            const prev = lines.get(idx);
            if (!prev || d >= prev.depth) lines.set(idx, { move: m[5], score, depth: d });
          }
        } else if (line.startsWith('bestmove')) {
          this.listeners = this.listeners.filter((f) => f !== handler);
          resolve(line.split(/\s+/)[1]);
        }
      };
      this.onLine(handler);
      this.send('position fen ' + fen);
      this.send('go depth ' + depth);
    });

    this.send('setoption name MultiPV value 1');

    if (!lines.size) return null;
    void result;
    return [...lines.values()].sort((a, b) => b.score - a.score);
  }

  /** Convenience wrapper: the lowest-ranked legal move. */
  async rankWorstMove(fen, legalCount, depth) {
    if (!legalCount || legalCount < 2) return null;
    const ranked = await this.rankMoves(fen, legalCount, depth);
    if (!ranked || !ranked.length) return null;
    return { worst: ranked[ranked.length - 1].move, ranked: ranked.length };
  }

  /** Ask for the best move from a FEN. Resolves with a UCI move string like "e2e4" or "e7e8q". */
  async bestMove(fen, movetimeMs) {
    // Emulated negative skill: rank candidates at normal depth, then apply
    // Stockfish's own skill-noise formula to choose among them.
    if (this.emulatedSkill !== null && this.emulatedSkill < 0) {
      const skill = this.emulatedSkill;
      const ranked = await this._rankFrom(fen, multipvForSkill(skill), WEAK_DEPTH);
      if (ranked && ranked.length) {
        const chosen = pickWithSkillNoise(ranked, skill);
        if (chosen) return chosen;
      }
      // Ranking unavailable — fall through to a plain search.
    }
    return this._plainBestMove(fen, movetimeMs);
  }

  _plainBestMove(fen, movetimeMs) {
    return new Promise((resolve) => {
      const handler = (line) => {
        if (line.startsWith('bestmove')) {
          this.listeners = this.listeners.filter((f) => f !== handler);
          resolve(line.split(/\s+/)[1]);
        }
      };
      this.onLine(handler);
      this.send('position fen ' + fen);
      this.send(this.weakDepth ? 'go depth ' + this.weakDepth : 'go movetime ' + movetimeMs);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SillyEngine,
    ENGINE_SOURCES,
    skillForElo,
    multipvForSkill,
    pickWithSkillNoise,
    WEAK_DEPTH,
  };
}
