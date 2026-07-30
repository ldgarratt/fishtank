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
}

console.log('Random-move probability model');
{
  assert(randomMoveProbability(ELO_MIN) === 0, 'no random moves at engine floor');
  assert(randomMoveProbability(700) === 0, 'no random moves at 700+ (depth/skill handle it)');
  assert(randomMoveProbability(0) === 0.3, 'capped at 30%');
  assert(clampUciElo(99999) === ELO_MAX, 'clamp upper');
  assert(clampUciElo(-5) === ELO_MIN, 'clamp lower');
}

console.log('');
if (failures) {
  console.error(failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('All tests passed ✔');
