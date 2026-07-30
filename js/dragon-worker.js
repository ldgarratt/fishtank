/*
 * DragonFish worker — amazon ("dragon") chess.
 *
 * Rules come from ffish.js, the official Fairy-Stockfish JS binding
 * (move legality, SAN, check detection for the built-in "amazon" variant,
 * where each queen is a dragon that also moves like a knight).
 *
 * The opponent is a small built-in alpha-beta search over ffish boards —
 * not the full NNUE engine (that build needs SharedArrayBuffer, which
 * GitHub Pages can't enable). Honest beta.
 */

'use strict';

const LOCAL_BASE = '../engine/fairy/';
const CDN_BASE = 'https://cdn.jsdelivr.net/npm/ffish@0.7.5/';

let ffish = null;
let board = null;
let pushCount = 0;

const VALS = { p: 100, n: 300, b: 320, r: 500, q: 900, a: 1150, k: 0 };
const THINK_MS = 1300;

function post(msg) {
  self.postMessage(msg);
}

function loadFfish(base, onFail) {
  try {
    self.Module = {
      locateFile: (p) => base + p,
      onRuntimeInitialized: () => {
        ffish = self.Module;
        onReady();
      },
      onAbort: () => onFail && onFail(new Error('wasm abort')),
    };
    importScripts(base + 'ffish.js');
    if (typeof self.Module === 'function') {
      // Modularized build: Module is a factory returning a promise.
      self.Module({ locateFile: (p) => base + p })
        .then((m) => {
          ffish = m;
          onReady();
        })
        .catch((e) => onFail && onFail(e));
    }
  } catch (e) {
    if (onFail) onFail(e);
  }
}

function onReady() {
  try {
    board = new ffish.Board('amazon');
    pushCount = 0;
    post({ type: 'ready' });
    post(stateMsg({}));
  } catch (e) {
    post({ type: 'fatal', error: 'ffish loaded but amazon board failed: ' + String(e) });
  }
}

function legalList(fnName) {
  const s = board[fnName]().trim();
  return s ? s.split(/\s+/) : [];
}

function inCheckNow() {
  try {
    return board.isCheck();
  } catch (e) {
    return /Checkers:\s*\S/.test(board.toVerboseString());
  }
}

function stateMsg(extra) {
  const fen = board.fen();
  const moves = legalList('legalMoves');
  const sans = legalList('legalMovesSan');
  const inCheck = inCheckNow();
  const turn = fen.split(' ')[1];
  const halfmove = parseInt(fen.split(' ')[4], 10) || 0;
  let over = false;
  let result = null; // 'w' | 'b' | 'draw'
  if (moves.length === 0) {
    over = true;
    result = inCheck ? (turn === 'w' ? 'b' : 'w') : 'draw';
  } else if (halfmove >= 100) {
    over = true;
    result = 'draw';
  }
  return Object.assign(
    { type: 'state', fen, moves, sans, inCheck, turn, over, result },
    extra
  );
}

function occupiedSet(fen) {
  const occ = new Set();
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < rows.length; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) f += parseInt(ch, 10);
      else {
        occ.add('abcdefgh'[f] + (8 - r));
        f++;
      }
    }
  }
  return occ;
}

function describeMove(uci) {
  const moves = legalList('legalMoves');
  const sans = legalList('legalMovesSan');
  const idx = moves.indexOf(uci);
  const san = idx >= 0 ? sans[idx] : uci;
  const captured = occupiedSet(board.fen()).has(uci.slice(2, 4));
  return { uci, san, captured };
}

/* ---------- search ---------- */

function evalWhite() {
  const placement = board.fen().split(' ')[0];
  let score = 0;
  for (const ch of placement) {
    const v = VALS[ch.toLowerCase()];
    if (v === undefined) continue;
    score += ch === ch.toLowerCase() ? -v : v;
  }
  return score;
}

let nodeCount = 0;
let deadline = 0;
let aborted = false;

function negamax(depth, alpha, beta, sign) {
  if ((++nodeCount & 63) === 0 && Date.now() > deadline) {
    aborted = true;
    return 0;
  }
  const moves = legalList('legalMoves');
  if (moves.length === 0) return inCheckNow() ? -100000 + (100 - depth) : 0;
  if (depth === 0) return sign * evalWhite();

  // Captures first for better pruning.
  const occ = occupiedSet(board.fen());
  moves.sort((m1, m2) => occ.has(m2.slice(2, 4)) - occ.has(m1.slice(2, 4)));

  let best = -Infinity;
  for (const m of moves) {
    board.push(m);
    const score = -negamax(depth - 1, -beta, -alpha, -sign);
    board.pop();
    if (aborted) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function think() {
  const moves = legalList('legalMoves');
  if (!moves.length) return null;
  const sign = board.fen().split(' ')[1] === 'w' ? 1 : -1;
  deadline = Date.now() + THINK_MS;
  nodeCount = 0;
  let bestMove = moves[Math.floor(Math.random() * moves.length)];

  for (let depth = 1; depth <= 3; depth++) {
    aborted = false;
    let bestScore = -Infinity;
    let bestAtDepth = null;
    for (const m of moves) {
      board.push(m);
      const score = -negamax(depth - 1, -Infinity, Infinity, -sign) + Math.random() * 10;
      board.pop();
      if (aborted) break;
      if (score > bestScore) {
        bestScore = score;
        bestAtDepth = m;
      }
    }
    if (aborted) break;
    if (bestAtDepth) bestMove = bestAtDepth;
  }
  return bestMove;
}

/* ---------- message handling ---------- */

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (!board) return;
    if (msg.type === 'new') {
      board.delete();
      board = new ffish.Board('amazon');
      pushCount = 0;
      post(stateMsg({}));
    } else if (msg.type === 'push') {
      const info = describeMove(msg.uci);
      board.push(msg.uci);
      pushCount++;
      post(stateMsg({ playerMove: info }));
    } else if (msg.type === 'think') {
      const uci = think();
      if (uci) {
        const info = describeMove(uci);
        board.push(uci);
        pushCount++;
        post(stateMsg({ engineMove: info }));
      }
    } else if (msg.type === 'undo') {
      let n = Math.min(msg.count || 2, pushCount);
      while (n-- > 0) {
        board.pop();
        pushCount--;
      }
      post(stateMsg({ undone: true }));
    }
  } catch (err) {
    post({ type: 'fatal', error: String(err) });
  }
};

loadFfish(LOCAL_BASE, () => {
  loadFfish(CDN_BASE, (e2) => {
    post({ type: 'fatal', error: 'Could not load ffish.js: ' + String(e2) });
  });
});
