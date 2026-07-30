/*
 * Full Fairy-Stockfish (NNUE WASM build) for DragonFish.
 *
 * The multithreaded build needs SharedArrayBuffer, which requires
 * cross-origin isolation — enabled on GitHub Pages via coi-serviceworker.js
 * (loaded in index.html; it registers a service worker that injects
 * COOP/COEP headers and reloads once). If isolation or the engine files are
 * unavailable (e.g. first visit before the SW reload, or older browsers),
 * DragonFish falls back to its built-in lite search.
 */
/* global Stockfish */

const FairyEngine = (() => {
  let initPromise = null;
  let sf = null;
  let lineHandlers = [];

  function expect(pred, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        lineHandlers = lineHandlers.filter((x) => x !== h);
        reject(new Error('engine timeout'));
      }, timeoutMs);
      const h = (line) => {
        if (pred(line)) {
          clearTimeout(timer);
          lineHandlers = lineHandlers.filter((x) => x !== h);
          resolve(line);
        }
      };
      lineHandlers.push(h);
    });
  }

  async function doInit() {
    if (!self.crossOriginIsolated) return false;
    const loaded = await new Promise((resolve) => {
      if (typeof Stockfish === 'function') return resolve(true);
      const s = document.createElement('script');
      s.src = 'engine/fairy/stockfish.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
    if (!loaded || typeof Stockfish !== 'function') return false;
    try {
      sf = await Stockfish();
      sf.addMessageListener((line) => {
        for (const h of [...lineHandlers]) h(line);
      });
      sf.postMessage('uci');
      await expect((l) => l.includes('uciok'), 15000);
      sf.postMessage('setoption name UCI_Variant value amazon');
      sf.postMessage('isready');
      await expect((l) => l.includes('readyok'), 10000);
      return true;
    } catch (e) {
      console.warn('FairyEngine init failed:', e);
      sf = null;
      return false;
    }
  }

  return {
    /** Resolves true if the full engine is usable. Safe to call repeatedly. */
    ready() {
      if (!initPromise) initPromise = doInit();
      return initPromise;
    },
    async bestMove(fen, movetimeMs) {
      if (!sf) return null;
      sf.postMessage('position fen ' + fen);
      sf.postMessage('go movetime ' + movetimeMs);
      try {
        const line = await expect((l) => l.startsWith('bestmove'), movetimeMs + 10000);
        const uci = line.split(/\s+/)[1];
        return uci && uci !== '(none)' ? uci : null;
      } catch (e) {
        return null;
      }
    },
    newGame() {
      if (sf) {
        sf.postMessage('ucinewgame');
        sf.postMessage('isready');
      }
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FairyEngine };
}
