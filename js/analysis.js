/*
 * Post-game analysis — walks the finished game with Stockfish at full
 * strength, scores every position, and classifies each move by how much
 * winning chance it threw away (the approach lichess and chess.com use).
 */
/* global Chess */

const Analysis = (() => {
  const MOVETIME_MS = 400; // per position; fixed time, never fixed depth
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

  function stdDev(xs) {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
  }

  /**
   * Per-move weights from how volatile the position was around that move
   * (lichess's approach). A slip in a sharp, swinging position counts for more
   * than one in a dead-drawn rook ending; the weight is the standard deviation
   * of the winning-chance curve in a window ending at that move, clamped to
   * 0.5..12 so no single move can dominate or vanish.
   */
  function volatilityWeights(series) {
    const n = Math.max(0, series.length - 1);
    const windowSize = Math.max(2, Math.min(8, Math.floor(series.length / 10)));
    const weights = [];
    for (let i = 0; i < n; i++) {
      // Early moves have no history behind them, so they borrow the first
      // full window rather than being scored on a window of one.
      const win =
        i + 1 >= windowSize
          ? series.slice(i + 1 - windowSize, i + 1)
          : series.slice(0, windowSize);
      weights.push(Math.max(0.5, Math.min(12, stdDev(win))));
    }
    return weights;
  }

  /**
   * Combine per-move accuracies into a game accuracy, the way lichess does:
   * the mean of a volatility-weighted mean and a harmonic mean.
   *
   * The harmonic mean is the important half. A plain average lets a handful of
   * disasters hide behind a pile of obvious recaptures — 25 moves at 95% and 5
   * at 5% averages to 80%, which is nonsense. The harmonic mean of the same
   * game is about 22%, because it is dominated by the smallest terms.
   */
  function aggregate(accuracies, weights) {
    if (!accuracies.length) return 100;
    const wSum = weights.reduce((a, b) => a + b, 0);
    const weighted = wSum
      ? accuracies.reduce((s, a, i) => s + a * weights[i], 0) / wSum
      : accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
    // Floor each term: a literal 0% would make the harmonic mean collapse to 0.
    const harmonic =
      accuracies.length / accuracies.reduce((s, a) => s + 1 / Math.max(a, 0.5), 0);
    return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
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
      scored.push(await engine.evaluate(fens[i], MOVETIME_MS));
      if (onProgress) onProgress(i + 1, fens.length);
    }

    // Winning chances for White at every position, used both for the per-move
    // accuracy and for the volatility weights.
    const whiteWin = scored.map((s, i) =>
      winPercent(i % 2 === 0 ? s.cp : -s.cp)
    );
    const allWeights = volatilityWeights(whiteWin);

    const moves = [];
    const graph = []; // centipawns from White's perspective, for the chart
    const acc = { w: [], b: [] };
    const wts = { w: [], b: [] };
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
      wts[mover].push(allWeights[i]);
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

    const summary = {
      w: {
        accuracy: aggregate(acc.w, wts.w),
        acpl: Math.round(lossTotals.w / Math.max(1, acc.w.length)),
        counts: counts.w,
      },
      b: {
        accuracy: aggregate(acc.b, wts.b),
        acpl: Math.round(lossTotals.b / Math.max(1, acc.b.length)),
        counts: counts.b,
      },
    };
    return { moves, summary, graph };
  }

  return {
    run,
    classify,
    winPercent,
    moveAccuracy,
    aggregate,
    volatilityWeights,
    stdDev,
    CLASSES,
    MOVETIME_MS,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Analysis };
}
