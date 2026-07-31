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

  function inBand(elo) {
    return elo >= MIN_ELO && elo <= MAX_ELO;
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
    worker = new Worker('js/maia-worker.js?v=37');
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
          console.warn('Maia:', msg.message);
        }
      }
    };
    worker.onerror = (e) => {
      console.warn('Maia worker failed:', e.message || e);
      disabled = true;
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

    onProgress = progressFn || null;
    readyPromise = (async () => {
      try {
        await loadTables();
        if (!worker) spawn();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timed out loading Maia')), 180000);
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
      pending.set(id, { resolve, reject });
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
