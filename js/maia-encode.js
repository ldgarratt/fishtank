/*
 * Maia 3 board encoding and policy decoding.
 *
 * Ported from the Maia platform's own implementation
 * (CSSLab/maia-platform-frontend, src/lib/engine/tensor.ts, GPL-3.0) so the
 * tensors we feed the model match exactly what it was trained on.
 *
 * Model interface:
 *   inputs   tokens   float32 [batch, 64, 12]  one-hot piece planes
 *            elo_self float32 [batch]          rating of the side to move
 *            elo_oppo float32 [batch]          rating of the opponent
 *   outputs  logits_move  float32 [4352]       policy over all possible moves
 *            logits_value float32 [3]          loss / draw / win
 *
 * The board is always presented from White's perspective: if Black is to move
 * the position is mirrored (and the chosen move mirrored back afterwards).
 */
/* global Chess */

const MaiaEncode = (() => {
  // Piece order the model expects: white P,N,B,R,Q,K then black p,n,b,r,q,k.
  const PIECE_TYPES = ['P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];
  const MOVE_COUNT = 4352;

  let moveIndex = null; // { "e2e4": 796, ... }
  let moveByIndex = null; // { 796: "e2e4", ... }

  function setMoveTables(forward, reversed) {
    moveIndex = forward;
    moveByIndex = reversed;
  }

  function mirrorSquare(square) {
    return square.charAt(0) + (9 - parseInt(square.charAt(1), 10)).toString();
  }

  function mirrorMove(uci) {
    const promotion = uci.length > 4 ? uci.substring(4) : '';
    return mirrorSquare(uci.substring(0, 2)) + mirrorSquare(uci.substring(2, 4)) + promotion;
  }

  function swapColorsInRank(rank) {
    let out = '';
    for (const ch of rank) {
      if (/[A-Z]/.test(ch)) out += ch.toLowerCase();
      else if (/[a-z]/.test(ch)) out += ch.toUpperCase();
      else out += ch;
    }
    return out;
  }

  function swapCastlingRights(castling) {
    if (castling === '-') return '-';
    const rights = new Set(castling.split(''));
    const swapped = new Set();
    if (rights.has('K')) swapped.add('k');
    if (rights.has('Q')) swapped.add('q');
    if (rights.has('k')) swapped.add('K');
    if (rights.has('q')) swapped.add('Q');
    let out = '';
    if (swapped.has('K')) out += 'K';
    if (swapped.has('Q')) out += 'Q';
    if (swapped.has('k')) out += 'k';
    if (swapped.has('q')) out += 'q';
    return out === '' ? '-' : out;
  }

  /** Flip the board vertically and swap colours, so Black to move becomes White to move. */
  function mirrorFEN(fen) {
    const [position, activeColor, castling, enPassant, halfmove, fullmove] = fen.split(' ');
    const mirroredPosition = position
      .split('/')
      .slice()
      .reverse()
      .map(swapColorsInRank)
      .join('/');
    return [
      mirroredPosition,
      activeColor === 'w' ? 'b' : 'w',
      swapCastlingRights(castling),
      enPassant !== '-' ? mirrorSquare(enPassant) : '-',
      halfmove,
      fullmove,
    ].join(' ');
  }

  /** FEN -> float32[64 * 12] one-hot piece planes. */
  function boardToTokens(fen) {
    const rows = fen.split(' ')[0].split('/');
    const tensor = new Float32Array(64 * 12);
    for (let rank = 0; rank < 8; rank++) {
      const row = 7 - rank;
      let file = 0;
      for (const ch of rows[rank]) {
        if (isNaN(parseInt(ch, 10))) {
          const pieceIdx = PIECE_TYPES.indexOf(ch);
          if (pieceIdx >= 0) tensor[(row * 8 + file) * 12 + pieceIdx] = 1;
          file += 1;
        } else {
          file += parseInt(ch, 10);
        }
      }
    }
    return tensor;
  }

  /**
   * Prepare a position for inference.
   * @returns { tokens, legalMask, blackToMove }
   */
  function preprocess(fen) {
    const blackToMove = fen.split(' ')[1] === 'b';
    const board = new Chess(blackToMove ? mirrorFEN(fen) : fen);

    const tokens = boardToTokens(board.fen());
    const legalMask = new Float32Array(MOVE_COUNT);
    for (const m of board.moves({ verbose: true })) {
      const idx = moveIndex[m.from + m.to + (m.promotion || '')];
      if (idx !== undefined) legalMask[idx] = 1;
    }
    return { tokens, legalMask, blackToMove };
  }

  /**
   * Turn raw model output into a move -> probability map (in the original
   * orientation) plus a win probability for the side to move.
   */
  function decode(logitsMove, logitsValue, legalMask, blackToMove) {
    const legalIdx = [];
    for (let i = 0; i < legalMask.length; i++) if (legalMask[i] > 0) legalIdx.push(i);

    const legalLogits = legalIdx.map((i) => logitsMove[i]);
    const maxLogit = Math.max(...legalLogits);
    const exp = legalLogits.map((l) => Math.exp(l - maxLogit));
    const sum = exp.reduce((a, b) => a + b, 0);

    const policy = {};
    legalIdx.forEach((idx, i) => {
      let move = moveByIndex[idx];
      if (blackToMove) move = mirrorMove(move);
      policy[move] = exp[i] / sum;
    });

    // logits_value is loss / draw / win for the side to move.
    const [l, d, w] = [logitsValue[0], logitsValue[1], logitsValue[2]];
    const maxV = Math.max(l, d, w);
    const eL = Math.exp(l - maxV);
    const eD = Math.exp(d - maxV);
    const eW = Math.exp(w - maxV);
    const winProb = (eW + 0.5 * eD) / (eL + eD + eW);

    return { policy, winProb };
  }

  /** Pick a move by sampling the policy, reproducing the human move distribution. */
  function sampleMove(policy, rng = Math.random) {
    const entries = Object.entries(policy);
    if (!entries.length) return null;
    let pick = rng();
    for (const [move, p] of entries) {
      pick -= p;
      if (pick <= 0) return move;
    }
    return entries[entries.length - 1][0];
  }

  /** The single most likely human move. */
  function topMove(policy) {
    let best = null;
    let bestP = -1;
    for (const [move, p] of Object.entries(policy)) {
      if (p > bestP) {
        bestP = p;
        best = move;
      }
    }
    return best;
  }

  return {
    setMoveTables,
    mirrorFEN,
    mirrorMove,
    mirrorSquare,
    swapCastlingRights,
    boardToTokens,
    preprocess,
    decode,
    sampleMove,
    topMove,
    MOVE_COUNT,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MaiaEncode };
}
