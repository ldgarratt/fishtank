/*
 * Maia — human-like move selection for bots inside its trained rating band.
 *
 * Maia 3 is a single network that takes the ratings of both players as inputs,
 * so one model covers the whole band rather than one network per rating. It
 * returns a probability distribution over legal moves: the moves humans of
 * that rating actually play. We sample from that distribution, which is why
 * its mistakes are human mistakes rather than "engine occasionally throws a
 * piece".
 *
 * Model and encoding by the University of Toronto CSSLab (GPL-3.0):
 * https://github.com/CSSLab/maia-chess
 */
/* global MaiaEncode */

const MaiaEngine = (() => {
  // The band Maia 3 is trained on. Outside it we fall back to Stockfish.
  const MIN_ELO = 1100;
  const MAX_ELO = 1900;
  const DEFAULT_OPPONENT_ELO = 1500; // we don't know the human's rating

  let worker = null;
  let ready = false;
  let readyPromise = null;
  let tablesLoaded = false;
  let disabled = false; // set if loading fails; never retried in this session
  let nextId = 0;
  const pending = new Map();
  let onProgress = null;

  // A single forward pass is milliseconds on a laptop, but the model is 44 MB
  // and phones routinely run out of memory loading it. If the worker dies or
  // stalls, every in-flight request has to fail loudly rather than leaving the
  // game waiting on a promise that will never settle.
  const INFER_TIMEOUT_MS = 15000;
  const LOAD_TIMEOUT_MS = 120000;

  function inBand(elo) {
    return elo >= MIN_ELO && elo <= MAX_ELO;
  }

  /** Reject everything outstanding and stop using Maia for this session. */
  function failAll(reason) {
    disabled = true;
    ready = false;
    for (const [, p] of pending) p.reject(new Error(reason));
    pending.clear();
  }

  /**
   * Whether this device should even attempt a 44 MB model. Phones that report
   * little memory will typically OOM part-way through loading the session,
   * which used to look like the game hanging at "100%".
   */
  function deviceCanCope() {
    const mem = navigator.deviceMemory; // GiB, coarse; undefined on Safari
    if (typeof mem === 'number' && mem < 4) return false;
    return true;
  }

  async function loadTables() {
    if (tablesLoaded) return;
    const [forward, reversed] = await Promise.all([
      fetch('js/data/all_moves_maia3.json').then((r) => r.json()),
      fetch('js/data/all_moves_maia3_reversed.json').then((r) => r.json()),
    ]);
    MaiaEncode.setMoveTables(forward, reversed);
    tablesLoaded = true;
  }

  function spawn() {
    worker = new Worker('js/maia-worker.js?v=51');
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'ready') {
        ready = true;
        return;
      }
      if (msg.type === 'progress') {
        if (onProgress) onProgress(msg.loaded, msg.total);
        return;
      }
      if (msg.type === 'result') {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.resolve({
            logitsMove: new Float32Array(msg.logitsMove),
            logitsValue: new Float32Array(msg.logitsValue),
          });
        }
        return;
      }
      if (msg.type === 'error') {
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id).reject(new Error(msg.message));
          pending.delete(msg.id);
        } else {
          // No id means the failure was in loading, not one request, so the
          // model is not coming: give up instead of polling until the timeout.
          console.warn('Maia:', msg.message);
          failAll(msg.message || 'Maia failed to load');
        }
      }
    };
    worker.onerror = (e) => {
      console.warn('Maia worker failed:', e.message || e);
      failAll('Maia worker crashed');
    };
  }

  /**
   * Make sure the model is downloaded and the session is live.
   * Resolves true if Maia is usable.
   */
  function ensureReady(progressFn) {
    if (disabled) return Promise.resolve(false);
    if (ready) return Promise.resolve(true);
    if (readyPromise) return readyPromise;
    if (!deviceCanCope()) {
      console.info('Maia skipped: device reports too little memory for a 44 MB model.');
      disabled = true;
      return Promise.resolve(false);
    }

    onProgress = progressFn || null;
    readyPromise = (async () => {
      try {
        await loadTables();
        if (!worker) spawn();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('timed out loading Maia')),
            LOAD_TIMEOUT_MS
          );
          const check = setInterval(() => {
            if (ready) {
              clearInterval(check);
              clearTimeout(timer);
              resolve();
            }
            if (disabled) {
              clearInterval(check);
              clearTimeout(timer);
              reject(new Error('worker failed'));
            }
          }, 120);
          worker.postMessage({ type: 'init' });
        });
        return true;
      } catch (err) {
        console.warn('Maia unavailable:', err.message);
        disabled = true;
        return false;
      } finally {
        readyPromise = null;
        onProgress = null;
      }
    })();
    return readyPromise;
  }

  function infer(tokens, eloSelf, eloOppo) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      // Without this timeout a worker that dies mid-inference (out of memory on
      // a phone, most likely) leaves this promise unsettled forever, and the
      // game simply stops — no error, no move, nothing to click.
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          failAll('Maia inference timed out');
          reject(new Error('Maia inference timed out'));
        }
      }, INFER_TIMEOUT_MS);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      const buf = tokens.buffer;
      worker.postMessage({ type: 'infer', id, tokens: buf, eloSelf, eloOppo }, [buf]);
    });
  }

  /**
   * Ask Maia for a move.
   * @returns { uci, policy, winProb, topMove } or null if unavailable.
   */
  async function pickMove(fen, elo, opponentElo = DEFAULT_OPPONENT_ELO) {
    if (!(await ensureReady())) return null;
    try {
      const { tokens, legalMask, blackToMove } = MaiaEncode.preprocess(fen);
      const { logitsMove, logitsValue } = await infer(tokens, elo, opponentElo);
      const { policy, winProb } = MaiaEncode.decode(
        logitsMove,
        logitsValue,
        legalMask,
        blackToMove
      );
      const uci = MaiaEncode.sampleMove(policy);
      if (!uci) return null;
      return { uci, policy, winProb, topMove: MaiaEncode.topMove(policy) };
    } catch (err) {
      console.warn('Maia inference failed:', err.message);
      return null;
    }
  }

  return {
    inBand,
    ensureReady,
    pickMove,
    isDisabled: () => disabled,
    isReady: () => ready,
    MIN_ELO,
    MAX_ELO,
    DEFAULT_OPPONENT_ELO,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MaiaEngine };
}
