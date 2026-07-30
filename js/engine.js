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
   *  - 1320..3190: Stockfish's own limiter (UCI_LimitStrength + UCI_Elo).
   *  - below 1320: the limiter can't go lower, so we approximate club/beginner
   *    play with Skill Level (adds move randomization) plus a shallow fixed
   *    search depth — depth 1-2 plays greedy, short-sighted chess like a
   *    real low-rated player rather than a coin-flipping one.
   */
  setStrength(effectiveElo) {
    const elo = Math.round(effectiveElo);
    if (elo === this.lastElo) return;
    this.lastElo = elo;
    if (elo >= 1320) {
      this.weakDepth = null;
      this.send('setoption name Skill Level value 20');
      this.send('setoption name UCI_LimitStrength value true');
      this.send('setoption name UCI_Elo value ' + Math.min(3190, elo));
    } else {
      this.send('setoption name UCI_LimitStrength value false');
      const skill = Math.max(0, Math.round(((elo - 100) / 1220) * 10)); // ~100->0, 1320->10
      this.send('setoption name Skill Level value ' + skill);
      this.weakDepth = elo < 400 ? 1 : elo < 700 ? 2 : elo < 1000 ? 3 : elo < 1200 ? 4 : 5;
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

  /** Ask for the best move from a FEN. Resolves with a UCI move string like "e2e4" or "e7e8q". */
  bestMove(fen, movetimeMs) {
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
  module.exports = { SillyEngine, ENGINE_SOURCES };
}
