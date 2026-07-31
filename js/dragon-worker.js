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

/* ---------- search ----------
 *
 * Alpha-beta with iterative deepening, quiescence, MVV-LVA ordering and
 * killer moves. The quiescence search is the important part: without it a
 * fixed-depth search happily stops halfway through a trade, "wins" a queen,
 * and never sees the recapture on the next ply.
 */

const MATE = 100000;
const MAX_PLY = 64;
const MAX_DEPTH = 24; // never reached in practice; time is the real limit
const FILES = 'abcdefgh';

/*
 * Piece-square tables, written from White's point of view with rank 8 as the
 * first row, so they read in the same order as a FEN. Black mirrors
 * vertically. Values are the widely used "simplified evaluation" tables,
 * with one addition: the dragon/amazon, which is strong enough that
 * centralising it matters more than it does for a queen.
 */
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  a: [
    -30, -20, -15, -10, -10, -15, -20, -30,
    -20, -5, 0, 5, 5, 0, -5, -20,
    -15, 0, 10, 15, 15, 10, 0, -15,
    -10, 5, 15, 20, 20, 15, 5, -10,
    -10, 5, 15, 20, 20, 15, 5, -10,
    -15, 0, 10, 15, 15, 10, 0, -15,
    -20, -5, 0, 5, 5, 0, -5, -20,
    -30, -20, -15, -10, -10, -15, -20, -30,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

/**
 * One pass over the FEN: piece placement, material + positional score from
 * White's point of view, and who is to move. Done once per node and reused
 * for both evaluation and move ordering — board.fen() is the expensive call
 * here, so calling it twice per node (as the old code did) cost real depth.
 */
function scan() {
  const parts = board.fen().split(' ');
  const rows = parts[0].split('/');
  const at = Object.create(null);
  let score = 0;
  for (let row = 0; row < 8; row++) {
    let file = 0;
    for (const ch of rows[row]) {
      if (ch >= '1' && ch <= '9') {
        file += +ch;
        continue;
      }
      const lower = ch.toLowerCase();
      at[FILES[file] + (8 - row)] = ch;
      const val = VALS[lower];
      if (val !== undefined) {
        const white = ch !== lower;
        const table = PST[lower];
        // Black reads the same table from the opposite end of the board.
        const pos = table ? table[(white ? row : 7 - row) * 8 + file] : 0;
        score += white ? val + pos : -(val + pos);
      }
      file++;
    }
  }
  return { at, score, whiteToMove: parts[1] === 'w' };
}

let nodeCount = 0;
let deadline = 0;
let aborted = false;
let rootBest = null;
let lastDepth = 0;
const killers = Array.from({ length: MAX_PLY + 1 }, () => [null, null]);

function outOfTime() {
  // ffish calls dominate the cost of a node, so checking often is cheap.
  return (++nodeCount & 31) === 0 && Date.now() > deadline;
}

function pieceValueAt(at, sq) {
  const ch = at[sq];
  return ch ? VALS[ch.toLowerCase()] || 0 : 0;
}

/**
 * Most Valuable Victim / Least Valuable Attacker, then killers, then the
 * rest. Good ordering is what makes alpha-beta actually prune.
 */
function order(moves, info, ply) {
  const killer = killers[ply];
  const rank = new Map();
  for (const m of moves) {
    const victim = pieceValueAt(info.at, m.slice(2, 4));
    let s;
    if (victim) s = 1e6 + victim * 16 - pieceValueAt(info.at, m.slice(0, 2));
    else if (m === killer[0]) s = 9e5;
    else if (m === killer[1]) s = 9e5 - 1;
    else s = m.length > 4 ? 8e5 : 0; // promotions before quiet moves
    rank.set(m, s);
  }
  moves.sort((a, b) => rank.get(b) - rank.get(a));
}

function rememberKiller(ply, move) {
  const k = killers[ply];
  if (k[0] === move) return;
  k[1] = k[0];
  k[0] = move;
}

/**
 * Search only forcing moves until the position is quiet, so the evaluation is
 * never taken in the middle of an exchange.
 */
function quiesce(alpha, beta, ply, movesIn, inChkIn) {
  if (outOfTime()) {
    aborted = true;
    return 0;
  }
  const moves = movesIn || legalList('legalMoves');
  const inChk = inChkIn === undefined ? inCheckNow() : inChkIn;
  if (!moves.length) return inChk ? -(MATE - ply) : 0;

  const info = scan();
  const standPat = info.whiteToMove ? info.score : -info.score;
  if (ply >= MAX_PLY) return standPat;

  if (!inChk) {
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
  }

  // Out of check, every move is a candidate escape; otherwise only captures.
  const candidates = inChk ? moves : moves.filter((m) => info.at[m.slice(2, 4)]);
  if (!candidates.length) return standPat;
  order(candidates, info, ply);

  let best = inChk ? -Infinity : standPat;
  for (const m of candidates) {
    // Delta pruning: skip captures that cannot drag the score up to alpha
    // even if they win the piece outright.
    if (!inChk && standPat + pieceValueAt(info.at, m.slice(2, 4)) + 200 < alpha) {
      continue;
    }
    board.push(m);
    const score = -quiesce(-beta, -alpha, ply + 1);
    board.pop();
    if (aborted) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function negamax(depth, alpha, beta, ply) {
  if (outOfTime()) {
    aborted = true;
    return 0;
  }
  const moves = legalList('legalMoves');
  if (!moves.length) {
    // Prefer mating sooner and being mated later.
    return inCheckNow() ? -(MATE - ply) : 0;
  }
  if (depth <= 0) return quiesce(alpha, beta, ply, moves, inCheckNow());

  const info = scan();
  order(moves, info, ply);
  if (ply === 0 && rootBest) {
    // Search the previous iteration's best move first.
    const i = moves.indexOf(rootBest);
    if (i > 0) moves.unshift(moves.splice(i, 1)[0]);
  }

  let best = -Infinity;
  let bestMove = null;
  for (const m of moves) {
    board.push(m);
    const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
    board.pop();
    if (aborted) return 0;
    if (score > best) {
      best = score;
      bestMove = m;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!info.at[m.slice(2, 4)]) rememberKiller(ply, m);
      break;
    }
  }
  if (ply === 0 && bestMove) rootBest = bestMove;
  return best;
}

function think() {
  const moves = legalList('legalMoves');
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  deadline = Date.now() + THINK_MS;
  nodeCount = 0;
  rootBest = null;
  lastDepth = 0;
  let best = moves[0];

  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    aborted = false;
    for (const k of killers) {
      k[0] = null;
      k[1] = null;
    }
    negamax(depth, -Infinity, Infinity, 0);
    // A half-finished iteration has only looked at some root moves, so its
    // answer is discarded and the last complete depth stands.
    if (aborted) break;
    if (rootBest) best = rootBest;
    lastDepth = depth;
    // No point starting a depth we clearly cannot finish.
    if (Date.now() > deadline - THINK_MS / 6) break;
  }
  return best;
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
      post(stateMsg(msg.byEngine ? { engineMove: info } : { playerMove: info }));
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
