/*
 * Post-game analysis — walks the finished game with Stockfish at full
 * strength, scores every position, and classifies each move by how much
 * winning chance it threw away (the approach lichess and chess.com use).
 */
/* global Chess */

const Analysis = (() => {
  const DEPTH = 12;
  const MATE_CP = 10000;

  // Thresholds in centipawns lost (standard-ish classification).
  const CLASSES = [
    { key: 'best', label: 'Best', icon: '★', max: 10 },
    { key: 'good', label: 'Good', icon: '·', max: 50 },
    { key: 'inaccuracy', label: 'Inaccuracy', icon: '?!', max: 100 },
    { key: 'mistake', label: 'Mistake', icon: '?', max: 300 },
    { key: 'blunder', label: 'Blunder', icon: '??', max: Infinity },
  ];

  function classify(loss) {
    return CLASSES.find((c) => loss <= c.max);
  }

  /** Winning chances 0..100 for the side the score belongs to (lichess curve). */
  function winPercent(cp) {
    const c = Math.max(-MATE_CP, Math.min(MATE_CP, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }

  /** Per-move accuracy from the drop in winning chances (lichess formula). */
  function moveAccuracy(winBefore, winAfter) {
    const drop = Math.max(0, winBefore - winAfter);
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
  }

  function uciToSan(fen, uci) {
    if (!uci || uci === '(none)') return null;
    try {
      const c = new Chess(fen);
      const mv = c.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      return mv ? mv.san : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * @param engine   SillyEngine instance (will be set to full strength)
   * @param pgnMoves verbose move list from chess.js (game.history({verbose:true}))
   * @param onProgress (done, total) => void
   * @returns { moves: [...], summary: { w: {...}, b: {...} }, graph: [cp...] }
   */
  async function run(engine, pgnMoves, onProgress) {
    engine.setFullStrength();

    // Collect the FEN before every move, plus the final position.
    const walker = new Chess();
    const fens = [walker.fen()];
    for (const m of pgnMoves) {
      walker.move(m.san);
      fens.push(walker.fen());
    }

    const scored = [];
    for (let i = 0; i < fens.length; i++) {
      scored.push(await engine.evaluate(fens[i], DEPTH));
      if (onProgress) onProgress(i + 1, fens.length);
    }

    const moves = [];
    const graph = []; // centipawns from White's perspective, for the chart
    const acc = { w: [], b: [] };
    const counts = {
      w: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      b: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
    };
    const lossTotals = { w: 0, b: 0 };

    for (let i = 0; i < pgnMoves.length; i++) {
      const mover = pgnMoves[i].color; // 'w' | 'b'
      // scored[i] is from the mover's perspective (they are to move);
      // scored[i+1] is from the opponent's, so negate it.
      const before = scored[i].cp;
      const after = -scored[i + 1].cp;
      const loss = Math.max(0, Math.min(1000, before - after));
      const cls = classify(loss);
      const accuracy = moveAccuracy(winPercent(before), winPercent(after));

      acc[mover].push(accuracy);
      counts[mover][cls.key] += 1;
      lossTotals[mover] += loss;

      const bestSan = uciToSan(fens[i], scored[i].best);
      moves.push({
        n: Math.floor(i / 2) + 1,
        color: mover,
        san: pgnMoves[i].san,
        loss,
        cls,
        evalAfter: mover === 'w' ? after : -after, // White's perspective
        best: bestSan && bestSan !== pgnMoves[i].san ? bestSan : null,
      });
      graph.push(mover === 'w' ? after : -after);
    }

    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 100);
    const summary = {
      w: {
        accuracy: mean(acc.w),
        acpl: counts.w ? Math.round(lossTotals.w / Math.max(1, acc.w.length)) : 0,
        counts: counts.w,
      },
      b: {
        accuracy: mean(acc.b),
        acpl: Math.round(lossTotals.b / Math.max(1, acc.b.length)),
        counts: counts.b,
      },
    };
    return { moves, summary, graph };
  }

  return { run, classify, winPercent, moveAccuracy, CLASSES, DEPTH };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Analysis };
}
