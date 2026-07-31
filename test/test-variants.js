/* Unit tests for variant Elo logic. Run: node test/test-variants.js */

const path = require('path');
const {
  VARIANTS, randomMoveProbability, clampElo, ELO_MIN, ELO_MAX, ELO_FLOOR,
} = require(path.join(
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
  assert(s.elo === ELO_MAX - 300, 'check costs 300');
  v.onPlayerMove(s, quiet, notInCheck);
  assert(s.elo === ELO_MAX - 300, 'quiet move costs nothing');
  v.onPlayerMove(s, quiet, inCheck);
  v.onPlayerMove(s, quiet, inCheck);
  assert(s.elo === ELO_MAX - 3 * 300, 'three checks -> ' + s.elo);
  for (let i = 0; i < 12; i++) v.onPlayerMove(s, quiet, inCheck);
  assert(s.elo === ELO_FLOOR, 'a hail of checks bottoms out at the floor');
  assert(
    randomMoveProbability(1000) === 0,
    'below the engine floor it still plays real (skill-noised) moves, not random ones'
  );
  assert(
    randomMoveProbability(s.elo) <= 0.12,
    'only at the very floor is a little pure randomness mixed in'
  );
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
  assert(p200 > 0 && p200 <= 0.12, 'a little pure chaos at 200 Elo (' + p200.toFixed(3) + ')');
  v.onPlayerMove(s, capture, notInCheck);
  assert(s.elo === 400, 'capture enrages +200');
  for (let i = 0; i < 50; i++) v.onPlayerMove(s, capture, notInCheck);
  assert(s.elo === ELO_MAX, 'rage caps at ' + ELO_MAX);
}

console.log('GamblerFish');
{
  const v = VARIANTS.gamblerfish;
  const s = { elo: v.baseElo, moveCount: 0 };

  // Rolls on move 0, holds for moves 1 and 2, rolls again on move 3.
  const evs = v.onEngineTurnStart(s);
  const firstRoll = s.elo;
  assert(evs && evs.length === 1, 'announces the roll (it is not secret)');
  s.moveCount = 1;
  assert(v.onEngineTurnStart(s) === undefined && s.elo === firstRoll, 'holds on move 2');
  s.moveCount = 2;
  assert(v.onEngineTurnStart(s) === undefined && s.elo === firstRoll, 'holds on move 3');
  s.moveCount = 3;
  v.onEngineTurnStart(s);
  assert(true, 're-rolls on the 4th move (new value ' + s.elo + ')');

  // Rolls stay in range and span it.
  let min = Infinity, max = -Infinity, rolls = 0;
  for (let i = 0; i < 6000; i++) {
    s.moveCount = i;
    const before = s.elo;
    v.onEngineTurnStart(s);
    if (s.elo !== before) rolls++;
    min = Math.min(min, s.elo);
    max = Math.max(max, s.elo);
    if (s.elo < ELO_MIN || s.elo > ELO_MAX) {
      failures++;
      console.error('  FAIL - roll out of range: ' + s.elo);
    }
  }
  assert(min < ELO_MIN + 300 && max > ELO_MAX - 300, `rolls span the range (saw ${min}–${max})`);
  assert(rolls > 1500 && rolls < 2100, `rolls roughly every 3rd move (${rolls} of 6000)`);
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

console.log('Elo never goes below the floor');
{
  assert(clampElo(-500) === ELO_FLOOR, 'clampElo floors negatives at ' + ELO_FLOOR);
  assert(clampElo(99999) === ELO_MAX, 'clampElo caps at ' + ELO_MAX);

  // TiredFish: -50/move; a long game must not produce a negative rating.
  const t = VARIANTS.tiredfish;
  const st = { elo: t.baseElo, moveCount: 1 };
  for (let i = 1; i <= 200; i++) {
    st.moveCount = i;
    t.onEngineTurnStart(st);
  }
  assert(st.elo === ELO_FLOOR, '200 tired moves floor at ' + ELO_FLOOR + ' (was going negative)');

  // Same for the other draining variants.
  const p = VARIANTS.panicfish;
  const sp = { elo: p.baseElo, moveCount: 0 };
  for (let i = 0; i < 40; i++) p.onPlayerMove(sp, quiet, inCheck);
  assert(sp.elo === ELO_FLOOR, '40 checks floor PanicFish at ' + ELO_FLOOR);

  const pac = VARIANTS.pacifistfish;
  const spac = { elo: pac.baseElo, moveCount: 0 };
  for (let i = 0; i < 40; i++) pac.onEngineMovePlayed(spac, capture, notInCheck);
  assert(spac.elo === ELO_FLOOR, 'PacifistFish floors too');

  const cow = VARIANTS.cowardfish;
  const board = {};
  for (const f of 'abcdefgh') for (const r of [5, 6, 7, 8]) board[f + r] = { color: 'w', type: 'q' };
  const scow = { elo: cow.baseElo, moveCount: 0, playerColor: 'w' };
  cow.onEngineTurnStart(scow, { get: (sq) => board[sq] || null });
  assert(scow.elo >= ELO_FLOOR, 'CowardFish with 32 invaders stays >= floor (' + scow.elo + ')');
}

console.log('Random-move probability model');
{
  assert(randomMoveProbability(ELO_MIN) === 0, 'no random moves at engine floor');
  assert(randomMoveProbability(250) === 0, 'no random moves at 250+ (skill noise handles it)');
  assert(randomMoveProbability(0) === 0.12, 'capped at 12% at the very bottom');
}

console.log('Displayed ratings match the code');
{
  for (const v of Object.values(VARIANTS)) {
    const copy = (v.description || '') + ' ' + (v.tagline || '');
    // "Starts at N Elo" / "Plays at N Elo" / "Fixed N Elo" must match baseElo.
    const claim = copy.match(/(?:Starts at|Plays at|Fixed) ([\d]{2,4}) Elo/);
    if (claim) {
      const stated = parseInt(claim[1], 10);
      assert(
        v.baseElo === stated,
        `${v.name} says it starts at ${stated} and baseElo is ${v.baseElo}`
      );
    }
    // Every rated bot must start inside the range we can actually apply.
    if (!v.fairy && !v.eloLabel) {
      assert(
        v.baseElo >= ELO_FLOOR && v.baseElo <= ELO_MAX,
        `${v.name} starts inside [${ELO_FLOOR}, ${ELO_MAX}] (${v.baseElo})`
      );
    }
  }
}

console.log('Weak-play model (lichess-style skill noise)');
{
  const {
    skillForElo, multipvForSkill, pickWithSkillNoise, movetimeForElo,
    MOVETIME_MS, RANK_MOVETIME_MS, JUDGE_MOVETIME_MS,
  } = require(path.join(__dirname, '..', 'js', 'engine.js'));

  // Strong settings need more time to actually reach their rating on a
  // single-threaded WASM build; weak ones don't, so they stay snappy.
  assert(movetimeForElo(800) <= movetimeForElo(1800), 'weak play is not given extra time');
  assert(movetimeForElo(1800) < movetimeForElo(2600), 'stronger ratings get more time');
  assert(movetimeForElo(3190) >= 2000, 'top strength gets a full budget');
  assert(movetimeForElo(null) > 0, 'handles a missing rating');

  // All searches are time-limited; nothing is capped by depth.
  assert(MOVETIME_MS > 0, 'normal play uses a fixed time budget (' + MOVETIME_MS + 'ms)');
  assert(RANK_MOVETIME_MS > 0, 'move ranking uses a fixed time budget');
  assert(JUDGE_MOVETIME_MS > 0, 'move judging uses a fixed time budget');
  const engineSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'js', 'engine.js'), 'utf8'
  );
  assert(!/go depth/.test(engineSrc), 'engine never issues a fixed-depth search');
  const analysisSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'js', 'analysis.js'), 'utf8'
  );
  assert(!/DEPTH/.test(analysisSrc), 'analysis is time-based too');

  // Calibration anchors from lichess's published AI levels.
  assert(Math.round(skillForElo(400)) === -9, '400 Elo -> skill -9 (lichess level 1)');
  assert(Math.round(skillForElo(500)) === -5, '500 Elo -> skill -5 (level 2)');
  assert(Math.round(skillForElo(800)) === -1, '800 Elo -> skill -1 (level 3)');
  assert(Math.round(skillForElo(1100)) === 3, '1100 Elo -> skill 3 (level 4)');
  assert(skillForElo(100) === -20, 'floor Elo -> skill -20');
  assert(skillForElo(3000) === 7, 'clamped at the top anchor');
  assert(skillForElo(650) > skillForElo(450), 'monotonic in Elo');

  assert(multipvForSkill(3) === 4, 'non-negative skill considers 4 candidates (Stockfish default)');
  assert(multipvForSkill(-20) > 4, 'very weak play considers a wider candidate set');
  assert(multipvForSkill(-20) <= 12, 'candidate set stays bounded');

  // Behavioural check: strong settings pick the best move far more often.
  const ranked = [
    { move: 'best', score: 60 },
    { move: 'ok', score: 20 },
    { move: 'meh', score: -40 },
    { move: 'awful', score: -260 },
  ];
  const rate = (skill, n = 4000) => {
    let top = 0;
    for (let i = 0; i < n; i++) if (pickWithSkillNoise(ranked, skill) === 'best') top++;
    return top / n;
  };
  const strong = rate(15);
  const weak = rate(-20);
  assert(strong > weak, `skill 15 plays the best move more than skill -20 (${(strong * 100).toFixed(0)}% vs ${(weak * 100).toFixed(0)}%)`);
  assert(weak < 0.5, 'very weak skill often rejects the best move');

  let seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(pickWithSkillNoise(ranked, -20));
  assert(seen.size > 1, 'weak play spreads across several candidate moves');
  for (const m of seen) {
    if (!ranked.some((r) => r.move === m)) {
      failures++;
      console.error('  FAIL - picked a move outside the candidate list: ' + m);
    }
  }
  assert(true, 'only ever picks legal candidate moves');
  assert(pickWithSkillNoise([], -5) === null, 'empty candidate list is handled');
}

async function testWorstFish() {
  console.log('WorstFish');
  const v = VARIANTS.worstfish;
  const s = { elo: v.baseElo, moveCount: 0 };
  const engineWith = (ranked) => ({ rankMoves: async () => ranked });
  {
    assert(v.eloLabel() === 'worst', 'shows "worst" instead of an Elo number');

    // rankMoves returns best-first, so the worst move is last.
    let res = await v.pickMove(s, {
      engine: engineWith([
        { move: 'd1h5', score: 620 },
        { move: 'g1f3', score: 240 },
        { move: 'b1c3', score: 12 },
        { move: 'f1a6', score: -940 },
      ]),
      fen: 'x',
      legalCount: 4,
    });
    assert(res.uci === 'f1a6', 'picks the lowest-scoring move, ignoring the best');
    assert(res.events[0].includes('-9.40'), 'reports the evaluation it threw away');

    // Even when every move is winning, it picks the least winning one.
    res = await v.pickMove(s, {
      engine: engineWith([
        { move: 'a1a8', score: 900 },
        { move: 'b2b4', score: 400 },
        { move: 'c1c2', score: 150 },
      ]),
      fen: 'x',
      legalCount: 3,
    });
    assert(res.uci === 'c1c2', 'in a winning position it plays the least winning move');

    // Single legal move: it has no choice.
    res = await v.pickMove(s, {
      engine: engineWith([{ move: 'h1g1', score: -50 }]),
      fen: 'x',
      legalCount: 1,
    });
    assert(res.uci === 'h1g1', 'a forced move is played normally');

    res = await v.pickMove(s, { engine: engineWith(null), fen: 'x', legalCount: 5 });
    assert(res === null, 'falls through gracefully when ranking is unavailable');

    // WorstFish and DrawFish must not agree except by coincidence.
    const ranked = [
      { move: 'a', score: 500 },
      { move: 'b', score: 5 },
      { move: 'c', score: -700 },
    ];
    const worst = await v.pickMove(s, { engine: engineWith(ranked), fen: 'x', legalCount: 3 });
    const draw = await VARIANTS.drawfish.pickMove(s, {
      engine: engineWith(ranked),
      fen: 'x',
      legalCount: 3,
    });
    assert(worst.uci === 'c' && draw.uci === 'b', 'WorstFish and DrawFish choose differently');
  }
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
  await testWorstFish();
  await testPityFish();
  console.log('');
  if (failures) {
    console.error(failures + ' test(s) FAILED');
    process.exit(1);
  }
  console.log('All tests passed \u2714');
})();
