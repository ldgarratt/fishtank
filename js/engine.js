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
    name: 'Stockfish 16.1 lite (CDN)',
    kind: 'cdn-wasm',
    base: 'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/src/',
    script: 'stockfish-16.1-lite-single.js',
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
  }

  _spawnLocal(src) {
    return new Worker(src.script);
  }

  _spawnCdn(src) {
    let shim;
    if (src.kind === 'cdn-wasm') {
      shim =
        `self.Module = { locateFile: function (p) { return ${JSON.stringify(src.base)} + p; } };\n` +
        `importScripts(${JSON.stringify(src.base + src.script)});`;
    } else {
      shim = `importScripts(${JSON.stringify(src.url)});`;
    }
    const blob = new Blob([shim], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
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
        this.worker = await this._tryInit(src, src.kind === 'local' ? 6000 : 25000);
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

  setStrength(uciElo) {
    if (uciElo === this.lastElo) return;
    this.lastElo = uciElo;
    this.send('setoption name UCI_LimitStrength value true');
    this.send('setoption name UCI_Elo value ' + uciElo);
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
      this.send('go movetime ' + movetimeMs);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SillyEngine, ENGINE_SOURCES };
}
