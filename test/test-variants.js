/* Unit tests for variant Elo logic. Run: node test/test-variants.js */

const path = require('path');
const { VARIANTS, randomMoveProbability, clampUciElo, ELO_MIN, ELO_MAX } = require(path.join(
  __dirname,
  '..',
  'js',
  'variants.js'
));

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok - ' + msg);
  else {
    failures++;
    console.error('  FAIL - ' + msg);
  }
}

// Minimal stand-ins for chess.js game objects.
const inCheck = { in_check: () => true };
const notInCheck = { in_check: () => false };
const capture = { captured: 'q' };
const quiet = {};

console.log('PanicFish');
{
  const v = VARIANTS.panicfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  assert(v.baseElo === ELO_MAX, 'starts at max elo ' + ELO_MAX);
  v.onPlayerMove(s, quiet, inCheck);
  assert(s.elo === ELO_MAX - 200, 'check costs 200');
  v.onPlayerMove(s, quiet, notInCheck);
  assert(s.elo === ELO_MAX - 200, 'quiet move costs nothing');
  for (let i = 0; i < 12; i++) v.onPlayerMove(s, quiet, inCheck);
  assert(s.elo === ELO_MAX - 13 * 200, '13 checks -> ' + s.elo + ' (goes below engine floor)');
  assert(clampUciElo(s.elo) === ELO_MIN, 'uci elo clamps at floor');
  assert(randomMoveProbability(s.elo) > 0, 'below floor -> random move chance');
}

console.log('TiltFish');
{
  const v = VARIANTS.tiltfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  v.onPlayerMove(s, capture, notInCheck);
  assert(s.elo === ELO_MAX - 200, 'capture costs 200');
  v.onPlayerMove(s, quiet, notInCheck);
  assert(s.elo === ELO_MAX - 200, 'quiet move costs nothing');
}

console.log('TiredFish');
{
  const v = VARIANTS.tiredfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  v.onEngineTurnStart(s);
  assert(s.elo === ELO_MAX, 'first move is free (not tired yet)');
  s.moveCount = 1;
  v.onEngineTurnStart(s);
  assert(s.elo === ELO_MAX - 50, 'each later move costs 50');
  s.elo = v.baseElo;
  for (let i = 1; i <= 40; i++) {
    s.moveCount = i;
    v.onEngineTurnStart(s);
  }
  assert(s.elo === ELO_MAX - 40 * 50, '40 moves -> ' + s.elo);
}

console.log('DrunkFish');
{
  const v = VARIANTS.drunkfish;
  assert(v.extraRandomChance({ moveCount: 0 }) === 0, 'sober at move 0');
  assert(Math.abs(v.extraRandomChance({ moveCount: 10 }) - 0.2) < 1e-9, '20% at move 10');
  assert(v.extraRandomChance({ moveCount: 100 }) === 0.8, 'capped at 80%');
}

console.log('RageFish');
{
  const v = VARIANTS.ragefish;
  const s = { elo: v.baseElo, moveCount: 0 };
  assert(v.baseElo === 200, 'starts at 200 Elo (way below engine floor)');
  const p200 = randomMoveProbability(200);
  assert(p200 > 0.2 && p200 < 0.3, 'small random-move chance at 200 (' + p200.toFixed(3) + ')');
  v.onPlayerMove(s, capture, notInCheck);
  assert(s.elo === 400, 'capture enrages +200');
  for (let i = 0; i < 50; i++) v.onPlayerMove(s, capture, notInCheck);
  assert(s.elo === ELO_MAX, 'rage caps at ' + ELO_MAX);
}

console.log('GamblerFish');
{
  const v = VARIANTS.gamblerfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 2000; i++) {
    v.onEngineTurnStart(s);
    min = Math.min(min, s.elo);
    max = Math.max(max, s.elo);
    assert2(s.elo >= ELO_MIN && s.elo <= ELO_MAX);
  }
  assert(min < ELO_MIN + 300 && max > ELO_MAX - 300, `rolls span the range (saw ${min}–${max})`);
  function assert2(c) {
    if (!c) {
      failures++;
      console.error('  FAIL - roll out of range: ' + s.elo);
    }
  }
}

console.log('SharkFish');
{
  const v = VARIANTS.sharkfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  assert(v.baseElo === 1600, 'starts at 1600');
  v.onEngineMovePlayed(s, quiet, inCheck);
  assert(s.elo === 1750, 'its check gains +150');
  v.onEngineMovePlayed(s, quiet, notInCheck);
  assert(s.elo === 1750, 'quiet move gains nothing');
  for (let i = 0; i < 20; i++) v.onEngineMovePlayed(s, quiet, inCheck);
  assert(s.elo === 3190, 'caps at 3190');
}

console.log('PacifistFish');
{
  const v = VARIANTS.pacifistfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  v.onEngineMovePlayed(s, capture, notInCheck);
  assert(s.elo === 3190 - 300, 'its capture costs 300');
  v.onEngineMovePlayed(s, quiet, notInCheck);
  assert(s.elo === 3190 - 300, 'quiet move costs nothing');
}

console.log('CowardFish');
{
  const v = VARIANTS.cowardfish;
  const s = { elo: v.baseElo, moveCount: 0, playerColor: 'w' };
  const board = { e5: { color: 'w', type: 'p' }, f6: { color: 'w', type: 'n' }, e4: { color: 'w', type: 'p' }, d8: { color: 'b', type: 'q' } };
  const fakeGame = { get: (sq) => board[sq] || null };
  const evs = v.onEngineTurnStart(s, fakeGame);
  assert(s.elo === 3190 - 200, 'two invaders (e5, f6) -> −200; own-half piece (e4) free');
  assert(evs && evs.length === 1, 'announces the invasion');
  const evs2 = v.onEngineTurnStart(s, fakeGame);
  assert(evs2 === undefined, 'no repeat announcement while count unchanged');
  delete board.e5; delete board.f6;
  v.onEngineTurnStart(s, fakeGame);
  assert(s.elo === 3190, 'recovers when its half clears');
}

console.log('ThreeCheckFish');
{
  const v = VARIANTS.threecheckfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  v.init(s);
  assert(v.checkCustomEnd(s) === undefined, 'no winner at start');
  v.onPlayerMove(s, quiet, inCheck);
  v.onPlayerMove(s, quiet, inCheck);
  assert(v.checkCustomEnd(s) === undefined, 'two checks is not enough');
  v.onPlayerMove(s, quiet, inCheck);
  assert(v.checkCustomEnd(s).winner === 'player', 'three player checks wins');
  v.init(s);
  v.onEngineMovePlayed(s, quiet, inCheck);
  v.onEngineMovePlayed(s, quiet, inCheck);
  v.onEngineMovePlayed(s, quiet, inCheck);
  assert(v.checkCustomEnd(s).winner === 'engine', 'three engine checks loses');

  const s2 = { elo: v.baseElo, moveCount: 0, playerColor: 'w' };
  v.init(s2);
  assert(v.kingLives(s2).w === 3 && v.kingLives(s2).b === 3, 'both kings start with 3 lives');
  v.onPlayerMove(s2, quiet, inCheck); // player checks the engine
  assert(v.kingLives(s2).b === 2 && v.kingLives(s2).w === 3, 'engine king loses a life');
  v.onEngineMovePlayed(s2, quiet, inCheck); // engine checks the player
  assert(v.kingLives(s2).w === 2, 'player king loses a life');

  const mateOnEngine = { in_checkmate: () => true, turn: () => 'b' }; // black (engine) is mated
  assert(v.kingLives(s2, mateOnEngine).b === 0, 'checkmated king shows 0 lives');
  assert(v.kingLives(s2, mateOnEngine).w === 2, 'winner keeps remaining lives');
  const mateOnPlayer = { in_checkmate: () => true, turn: () => 'w' };
  assert(v.kingLives(s2, mateOnPlayer).w === 0, 'mated player king shows 0 lives');
}

console.log('Random-move probability model');
{
  assert(randomMoveProbability(ELO_MIN) === 0, 'no random moves at engine floor');
  assert(randomMoveProbability(700) === 0, 'no random moves at 700+ (depth/skill handle it)');
  assert(randomMoveProbability(0) === 0.3, 'capped at 30%');
  assert(clampUciElo(99999) === ELO_MAX, 'clamp upper');
  assert(clampUciElo(-5) === ELO_MIN, 'clamp lower');
}

async function testPityFish() {
  console.log('PityFish');
  const v = VARIANTS.pityfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  const fakeEngine = (worst) => ({ rankWorstMove: async () => ({ worst, ranked: 20 }) });
  const ctx = (from, to, promotion) => ({
    move: { from, to, promotion, san: from + to },
    engine: fakeEngine('a1a2'),
    fenBefore: 'startpos',
    legalCount: 20,
  });
  {
    assert(v.baseElo === 3190, 'starts at full strength');

    let evs = await v.onPlayerMoveAsync(s, ctx('e2', 'e4'));
    assert(s.elo === 3190 && !evs, 'a normal move costs nothing');

    evs = await v.onPlayerMoveAsync(s, ctx('a1', 'a2'));
    assert(s.elo === 2690, 'playing the worst move costs 500');
    assert(evs && evs.length === 1, 'announces the pity');

    await v.onPlayerMoveAsync(s, ctx('a1', 'a2'));
    assert(s.elo === 2190, 'repeat offences keep costing 500');

    // Promotion suffix should not defeat the comparison.
    const s2 = { elo: v.baseElo, moveCount: 0 };
    const promoCtx = {
      move: { from: 'a7', to: 'a8', promotion: 'n', san: 'a8=N' },
      engine: fakeEngine('a7a8'),
      fenBefore: 'x',
      legalCount: 12,
    };
    await v.onPlayerMoveAsync(s2, promoCtx);
    assert(s2.elo === 2690, 'promotion suffix mismatch still matches the worst move');

    // Forced moves are never punished.
    const s3 = { elo: v.baseElo, moveCount: 0 };
    await v.onPlayerMoveAsync(s3, {
      move: { from: 'a1', to: 'a2', san: 'Ka2' },
      engine: fakeEngine('a1a2'),
      fenBefore: 'x',
      legalCount: 1,
    });
    assert(s3.elo === 3190, 'a forced (only legal) move is not punished');
  }
}

async function testDrawFish() {
  console.log('DrawFish');
  const v = VARIANTS.drawfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  const engineWith = (ranked) => ({ rankMoves: async () => ranked });
  {
    assert(v.eloLabel() === '0.00', 'shows 0.00 instead of an Elo number');

    // Winning moves available, but it wants the level one.
    let res = await v.pickMove(s, {
      engine: engineWith([
        { move: 'd1h5', score: 620 },
        { move: 'g1f3', score: 240 },
        { move: 'b1c3', score: 12 },
        { move: 'f1a6', score: -180 },
      ]),
      fen: 'x',
      legalCount: 4,
    });
    assert(res.uci === 'b1c3', 'picks the move closest to 0.00 (+0.12), not the best (+6.20)');
    assert(res.events[0].includes('+0.12'), 'reports the evaluation it chose');

    // Negative side of zero counts equally.
    res = await v.pickMove(s, {
      engine: engineWith([
        { move: 'a2a3', score: 300 },
        { move: 'b2b3', score: -5 },
        { move: 'c2c3', score: 40 },
      ]),
      fen: 'x',
      legalCount: 3,
    });
    assert(res.uci === 'b2b3', 'a small negative eval beats a larger positive one');

    // Losing position: least-bad option.
    res = await v.pickMove(s, {
      engine: engineWith([
        { move: 'h1g1', score: -400 },
        { move: 'h1h2', score: -900 },
      ]),
      fen: 'x',
      legalCount: 2,
    });
    assert(res.uci === 'h1g1', 'when all moves lose, it plays the least-bad');

    res = await v.pickMove(s, { engine: engineWith(null), fen: 'x', legalCount: 5 });
    assert(res === null, 'falls through gracefully when ranking is unavailable');
  }
}

console.log('Analysis scoring');
{
  const { Analysis } = require(path.join(__dirname, '..', 'js', 'analysis.js'));
  assert(Math.abs(Analysis.winPercent(0) - 50) < 1e-6, 'even position = 50% win chance');
  assert(Analysis.winPercent(300) > 70, '+3 pawns is a large advantage (' +
    Analysis.winPercent(300).toFixed(1) + '%)');
  assert(Analysis.winPercent(-300) < 30, '-3 pawns is losing');
  assert(
    Math.abs(Analysis.winPercent(200) + Analysis.winPercent(-200) - 100) < 1e-6,
    'win chances are symmetric'
  );

  assert(Analysis.classify(0).key === 'best', '0 cp lost = best');
  assert(Analysis.classify(45).key === 'good', '45 cp lost = good');
  assert(Analysis.classify(80).key === 'inaccuracy', '80 cp lost = inaccuracy');
  assert(Analysis.classify(150).key === 'mistake', '150 cp lost = mistake');
  assert(Analysis.classify(600).key === 'blunder', '600 cp lost = blunder');

  assert(Math.abs(Analysis.moveAccuracy(50, 50) - 100) < 0.1, 'no loss = ~100% accuracy');
  const hangQueen = Analysis.moveAccuracy(Analysis.winPercent(0), Analysis.winPercent(-900));
  assert(hangQueen < 25, 'hanging a queen tanks accuracy (' + hangQueen.toFixed(1) + '%)');
  assert(
    Analysis.moveAccuracy(50, 45) > Analysis.moveAccuracy(50, 30),
    'smaller drops score higher'
  );
}

// Async suites run last, then the overall result is reported.
(async () => {
  await testDrawFish();
  await testPityFish();
  console.log('');
  if (failures) {
    console.error(failures + ' test(s) FAILED');
    process.exit(1);
  }
  console.log('All tests passed \u2714');
})();
