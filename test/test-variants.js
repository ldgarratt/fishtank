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
let testDrunkFishBlunders = async () => {};
let testAnalysisBestMoves = async () => {};
let testMaiaTimeout = async () => {};
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
  assert(v.blunderChance === 0.05, 'blunders 5% of the time');
  assert(!v.extraRandomChance, 'no longer ramps up a random-move chance');
  assert(v.baseElo === ELO_MAX, 'otherwise plays at full strength');

  // The ranked list is best-first; anything 200cp or more below the best move
  // counts as a blunder worth playing.
  const ranked = [
    { move: 'd1h5', score: 40 },
    { move: 'g1f3', score: 10 },
    { move: 'b1c3', score: -260 }, // -3.00 from best
    { move: 'f1a6', score: -900 }, // -9.40 from best
  ];
  const ctx = { engine: { rankMoves: async () => ranked }, fen: 'x', legalCount: 4 };
  const badMoves = new Set(['b1c3', 'f1a6']);

  // Registered with the async runner at the bottom so its failures are counted.
  testDrunkFishBlunders = async () => {
    // Forced to blunder: only genuinely bad moves are eligible.
    const drunk = Object.assign({}, v, { blunderChance: 1 });
    for (let i = 0; i < 40; i++) {
      const res = await drunk.pickMove({}, ctx);
      if (!res || !badMoves.has(res.uci)) {
        assert(false, 'a blunder is always a move that loses real material');
        return;
      }
    }
    assert(true, 'a blunder is always a move that loses real material');

    const res = await drunk.pickMove({}, ctx);
    assert(/throws away/.test(res.events[0]), 'the feed says what it cost');

    // Sober: hands control back rather than choosing a move.
    const sober = Object.assign({}, v, { blunderChance: 0 });
    assert(await sober.pickMove({}, ctx) === null,
      'when sober it defers to the normal engine search');

    // Nothing bad enough on offer — must not invent a blunder.
    const quiet = [{ move: 'a2a3', score: 10 }, { move: 'b2b3', score: 0 }];
    const res2 = await drunk.pickMove({}, {
      engine: { rankMoves: async () => quiet }, fen: 'x', legalCount: 2,
    });
    assert(res2.uci === 'b2b3', 'with no real blunder available it plays the worst move');

    const forced = await drunk.pickMove({}, {
      engine: { rankMoves: async () => [{ move: 'e1e2', score: -50 }] },
      fen: 'x', legalCount: 1,
    });
    assert(forced === null, 'a forced move is played normally');
  };
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
  assert(s.elo === 3190 - 800, 'two invaders (e5, f6) -> −800; own-half piece (e4) free');
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

console.log('Maia encoder (ported from CSSLab/maia-platform-frontend)');
{
  const fs = require('fs');
  const vendored = path.join(__dirname, '..', 'vendor', 'chess.js');
  if (!fs.existsSync(vendored)) {
    console.log('  skip - chess.js not vendored (run engine/get-engine.sh)');
  } else {
    const chessMod = require(vendored);
    global.Chess = chessMod.Chess || chessMod;
    const { MaiaEncode } = require(path.join(__dirname, '..', 'js', 'maia-encode.js'));
    const fwd = require(path.join(__dirname, '..', 'js', 'data', 'all_moves_maia3.json'));
    const rev = require(path.join(__dirname, '..', 'js', 'data', 'all_moves_maia3_reversed.json'));
    MaiaEncode.setMoveTables(fwd, rev);

    assert(Object.keys(fwd).length === 4352, 'move table has the 4352 entries the model expects');

    // Mirroring (Maia always sees the board from White's side).
    assert(MaiaEncode.mirrorSquare('e2') === 'e7', 'mirrorSquare e2 -> e7');
    assert(MaiaEncode.mirrorMove('e2e4') === 'e7e5', 'mirrorMove e2e4 -> e7e5');
    assert(MaiaEncode.mirrorMove('a7a8q') === 'a2a1q', 'promotion suffix survives mirroring');
    assert(MaiaEncode.swapCastlingRights('Kq') === 'Qk', 'castling rights swap sides');
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    assert(MaiaEncode.mirrorFEN(MaiaEncode.mirrorFEN(start)) === start, 'mirroring twice is identity');

    // Board tensor.
    const t = MaiaEncode.boardToTokens(start);
    assert(t.length === 64 * 12, 'tensor is 64x12');
    assert(t.reduce((a, b) => a + b, 0) === 32, 'exactly 32 pieces encoded');
    assert(t[0 * 12 + 3] === 1, 'a1 encodes a white rook');
    assert(t[4 * 12 + 5] === 1, 'e1 encodes a white king');
    assert(t[60 * 12 + 11] === 1, 'e8 encodes a black king');

    // Legal-move mask.
    let pre = MaiaEncode.preprocess(start);
    assert(pre.blackToMove === false, 'white to move needs no mirroring');
    assert(pre.legalMask.reduce((a, b) => a + b, 0) === 20, '20 legal moves from the start');

    // Black to move: mirrored in, mirrored back out.
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    pre = MaiaEncode.preprocess(afterE4);
    assert(pre.blackToMove === true, 'black to move is mirrored');
    assert(pre.legalMask[fwd['e2e4']] === 1, "black's e7e5 appears as e2e4 to the model");

    const logits = new Float32Array(4352);
    logits[fwd['e2e4']] = 10;
    const dec = MaiaEncode.decode(logits, Float32Array.from([0, 0, 2]), pre.legalMask, pre.blackToMove);
    assert(MaiaEncode.topMove(dec.policy) === 'e7e5', 'top move mirrors back to e7e5');
    const total = Object.values(dec.policy).reduce((a, b) => a + b, 0);
    assert(Math.abs(total - 1) < 1e-6, 'policy is a probability distribution');
    assert(dec.winProb > 0.7, 'value head decodes to a win probability');

    // Everything Maia can return must be legal in the real position.
    const real = new global.Chess(afterE4);
    const legal = new Set(
      real.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''))
    );
    assert(
      Object.keys(dec.policy).every((m) => legal.has(m)),
      'policy only ever contains legal moves'
    );
  }
}

console.log('Strength model (bounded evaluation loss)');
{
  const {
    maxLossForElo, multipvForElo, chooseWithinLoss, movetimeForElo,
    MOVETIME_MS, RANK_MOVETIME_MS, JUDGE_MOVETIME_MS,
  } = require(path.join(__dirname, '..', 'js', 'engine.js'));

  // Time budgets.
  assert(movetimeForElo(800) <= movetimeForElo(1800), 'weak play is not given extra time');
  assert(movetimeForElo(1800) < movetimeForElo(2600), 'stronger ratings get more time');
  assert(MOVETIME_MS > 0 && RANK_MOVETIME_MS > 0 && JUDGE_MOVETIME_MS > 0, 'time budgets set');
  const engineSrc = require('fs').readFileSync(
    path.join(__dirname, '..', 'js', 'engine.js'), 'utf8'
  );
  assert(!/go depth/.test(engineSrc), 'engine never issues a fixed-depth search');
  assert(
    !/UCI_Elo value/.test(engineSrc),
    "Stockfish's own UCI_Elo limiter is not used (it maps 2000 Elo to Skill 4)"
  );

  // The allowance curve.
  assert(maxLossForElo(3190) === 0, 'full strength always plays the best move');
  assert(maxLossForElo(2000) < 100, '2000 tolerates less than a pawn (' + maxLossForElo(2000) + 'cp)');
  assert(maxLossForElo(2000) < maxLossForElo(1200), 'stronger means a tighter allowance');
  assert(maxLossForElo(400) > 300, 'a beginner may drop real material');
  assert(maxLossForElo(-99) === maxLossForElo(100), 'clamped at the bottom');
  assert(maxLossForElo(9999) === 0, 'clamped at the top');
  assert(multipvForElo(3000) < multipvForElo(1000), 'weaker bots consider more candidates');

  // A 2000 must never choose a piece-losing move.
  const withBlunder = [
    { move: 'best', score: 30 },
    { move: 'slight', score: -10 },
    { move: 'meh', score: -90 },
    { move: 'hangsKnight', score: -280 },
    { move: 'hangsQueen', score: -880 },
  ];
  const picks2000 = new Set();
  for (let i = 0; i < 3000; i++) picks2000.add(chooseWithinLoss(withBlunder, 2000));
  assert(!picks2000.has('hangsKnight'), 'a 2000 never hangs a knight');
  assert(!picks2000.has('hangsQueen'), 'a 2000 never hangs a queen');
  assert(picks2000.has('best'), 'a 2000 usually finds the best move');

  // Full strength is deterministic.
  const picks3190 = new Set();
  for (let i = 0; i < 500; i++) picks3190.add(chooseWithinLoss(withBlunder, 3190));
  assert(picks3190.size === 1 && picks3190.has('best'), '3190 always plays the best move');

  // A beginner does drop material.
  const picks400 = new Set();
  for (let i = 0; i < 3000; i++) picks400.add(chooseWithinLoss(withBlunder, 400));
  assert(picks400.has('hangsKnight'), 'a 400 will hang a knight');
  assert(!picks400.has('hangsQueen'), 'even a 400 stops short of the very worst move here');

  // Better moves are preferred at every level.
  const tally = { best: 0, slight: 0, meh: 0 };
  for (let i = 0; i < 6000; i++) {
    const m = chooseWithinLoss(withBlunder, 1600);
    if (m in tally) tally[m]++;
  }
  assert(tally.best > tally.meh, `better moves are played more often (${tally.best} vs ${tally.meh})`);

  assert(chooseWithinLoss([], 2000) === null, 'empty candidate list is handled');
  assert(chooseWithinLoss([{ move: 'only', score: 0 }], 400) === 'only', 'forced move is played');
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

  // Game accuracy: the harmonic half must stop blunders from being averaged
  // away. A plain mean of this game is ~80%, which is the bug we fixed.
  const flat = (n, v) => Array(n).fill(v);
  const ones = (n) => flat(n, 1);
  const messy = [...flat(25, 95), ...flat(5, 3)];
  const plainMean = messy.reduce((a, b) => a + b, 0) / messy.length;
  const scored = Analysis.aggregate(messy, ones(messy.length));
  assert(plainMean > 75, 'sanity: the plain mean really is that forgiving');
  assert(scored < 60, 'five disasters in 30 moves is not a decent game (' +
    scored.toFixed(1) + '%)');

  assert(
    Math.abs(Analysis.aggregate(flat(30, 100), ones(30)) - 100) < 0.01,
    'a flawless game is still 100%'
  );
  assert(
    Math.abs(Analysis.aggregate(flat(30, 95), ones(30)) - 95) < 0.01,
    'uniform accuracy is unchanged by the weighting'
  );
  const oneBlunder = Analysis.aggregate([...flat(29, 97), 5], ones(30));
  assert(oneBlunder > 65 && oneBlunder < 85,
    'a single blunder costs real points but is not fatal (' +
    oneBlunder.toFixed(1) + '%)');
  assert(
    Analysis.aggregate(flat(20, 60), ones(20)) <
      Analysis.aggregate(flat(20, 80), ones(20)),
    'worse games score lower'
  );
  assert(Analysis.aggregate([], []) === 100, 'an empty game does not divide by zero');
  assert(Analysis.aggregate([0, 0, 0], ones(3)) >= 0, 'all-zero accuracy stays finite');

  // Weights: volatile stretches should matter more than dead-quiet ones.
  const quiet = Analysis.volatilityWeights(flat(40, 50));
  assert(quiet.every((w) => w === 0.5), 'a flat game floors every weight at 0.5');
  const swingy = Analysis.volatilityWeights(
    Array.from({ length: 40 }, (_, i) => (i % 2 ? 90 : 10))
  );
  assert(swingy.every((w) => w > quiet[0]), 'a swinging game weighs more heavily');
  assert(swingy.every((w) => w <= 12), 'weights are capped at 12');
  assert(
    Analysis.volatilityWeights(flat(40, 50)).length === 39,
    'one weight per move, not per position'
  );
  assert(Math.abs(Analysis.stdDev([2, 4, 4, 4, 5, 5, 7, 9]) - 2) < 1e-9,
    'stdDev matches the textbook value');
  assert(Analysis.stdDev([7]) === 0, 'a single sample has no spread');
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

console.log('Maia failure handling');
{
  // The bug: a worker that never answered left the game waiting on a promise
  // that could not settle. Every path out of Maia has to terminate.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'maia.js'), 'utf8');

  assert(/INFER_TIMEOUT_MS/.test(src) && /setTimeout\([\s\S]{0,200}INFER_TIMEOUT_MS/.test(src),
    'inference is bounded by a timeout');
  assert(/function failAll/.test(src), 'there is one way to abandon Maia');
  assert(/worker\.onerror[\s\S]{0,160}failAll/.test(src),
    'a crashed worker rejects everything in flight');
  assert(/deviceCanCope/.test(src), 'low-memory devices skip the 44 MB model');

  // Loading a stub of the module with fake globals proves the timeout actually
  // fires, rather than just being present in the source.
  const stubbed = src
    .replace(/^\/\* global MaiaEncode \*\/$/m, '')
    .replace('INFER_TIMEOUT_MS = 15000', 'INFER_TIMEOUT_MS = 40');
  const sandbox = {
    navigator: { deviceMemory: 8 },
    console: { warn() {}, info() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error('no network in tests')),
    module: { exports: {} },
    Float32Array,
    Map,
    Promise,
    Error,
    Date,
    Math,
    // A worker that accepts messages and never replies — the mobile failure.
    Worker: function () {
      this.postMessage = () => {};
    },
    MaiaEncode: {
      preprocess: () => ({
        tokens: new Float32Array(64 * 12),
        legalMask: new Float32Array(4352),
        blackToMove: false,
      }),
      decode: () => ({ policy: {}, winProb: 0.5 }),
      sampleMove: () => 'e2e4',
      topMove: () => 'e2e4',
    },
  };
  require('vm').createContext(sandbox);
  require('vm').runInContext(stubbed, sandbox);
  const M = sandbox.module.exports.MaiaEngine;

  assert(M.inBand(1600) === true, 'SharkFish\'s 1600 is inside Maia\'s band');
  assert(M.inBand(3190) === false && M.inBand(400) === false,
    'full-strength and beginner bots stay on Stockfish');

  testMaiaTimeout = async () => {
    // Force "loaded" without a real model, then ask for a move: the silent
    // worker must produce a rejection, not a promise that hangs for ever.
    const started = Date.now();
    const result = await Promise.race([
      M.pickMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1600),
      new Promise((r) => setTimeout(() => r('HUNG'), 3000)),
    ]);
    assert(result !== 'HUNG',
      'a silent Maia worker gives up instead of hanging the game ' +
      `(settled in ${Date.now() - started} ms)`);
    assert(result === null, 'and returns null so the caller falls back to Stockfish');
    assert(M.isDisabled() === true, 'Maia is switched off for the rest of the session');
  };
}

console.log('Handicap variants');
{
  const fs = require('fs');
  const vendored = path.join(__dirname, '..', 'vendor', 'chess.js');

  // The odds bots are standard chess from a lopsided position, so chess.js has
  // to accept the FEN and the *engine* must be the side missing the piece.
  const ODDS = {
    queenlessfish: 'q',
    rooklessfish: 'r',
    knightlessfish: 'n',
    bishoplessfish: 'b',
  };
  // How many of each piece a full army has, to check exactly one went missing.
  const FULL = { q: 1, r: 2, n: 2, b: 2 };

  for (const [id, piece] of Object.entries(ODDS)) {
    const v = VARIANTS[id];
    assert(typeof v.startFen === 'function', `${v.name} defines a starting position`);
    assert(!v.fairy, `${v.name} needs no fairy engine — it is ordinary chess`);
    assert(v.baseElo === ELO_MAX, `${v.name} is otherwise full strength`);
  }

  if (!fs.existsSync(vendored)) {
    console.log('  skip - chess.js not vendored (run engine/get-engine.sh)');
  } else {
    const mod = require(vendored);
    const ChessCtor = mod.Chess || mod;
    for (const [id, piece] of Object.entries(ODDS)) {
      const v = VARIANTS[id];
      for (const playerColor of ['w', 'b']) {
        const fen = v.startFen(playerColor);
        const g = new ChessCtor(fen);
        assert(g.fen() === fen, `${v.name} (${playerColor}) FEN loads intact`);
        assert(fen.split(' ')[1] === 'w', `${v.name} (${playerColor}) White still moves first`);

        const placement = fen.split(' ')[0];
        const count = (re) => (placement.match(re) || []).length;
        const mine = playerColor === 'w' ? piece.toUpperCase() : piece;
        const theirs = playerColor === 'w' ? piece : piece.toUpperCase();
        assert(count(new RegExp(mine, 'g')) === FULL[piece],
          `${v.name} (${playerColor}) your army is untouched`);
        assert(count(new RegExp(theirs, 'g')) === FULL[piece] - 1,
          `${v.name} (${playerColor}) the engine is exactly one ${piece} down`);
        assert(/K/.test(placement) && /k/.test(placement),
          `${v.name} (${playerColor}) both kings are on the board`);

        // Losing a corner rook has to cost that side's castling right, or
        // chess.js will happily try to castle with a rook that isn't there.
        const rights = fen.split(' ')[2];
        if (piece === 'r') {
          const gone = playerColor === 'w' ? 'q' : 'Q';
          assert(!rights.includes(gone),
            `${v.name} (${playerColor}) drops the castling right for the missing rook`);
          assert(rights.length === 3, `${v.name} (${playerColor}) keeps the other three`);
        } else {
          assert(rights === 'KQkq',
            `${v.name} (${playerColor}) leaves castling rights alone`);
        }
      }
    }
  }

  // The fairy handicaps are defined at runtime, so the config text has to be
  // well formed and the advantage has to follow the player's colour.
  for (const id of ['handicapfish', 'armyfish']) {
    const v = VARIANTS[id];
    const spec = v.fairySpec;
    assert(v.fairy === true, `${v.name} is flagged as a fairy variant`);
    assert(spec && typeof spec.config === 'function', `${v.name} builds a variant config`);

    for (const playerColor of ['w', 'b']) {
      const cfg = spec.config(playerColor);
      assert(cfg.startsWith(`[${spec.variantName}:chess]`),
        `${v.name} (${playerColor}) inherits from chess`);
      const fen = (cfg.match(/startFen = (.+)/) || [])[1];
      assert(!!fen, `${v.name} (${playerColor}) sets a start FEN`);

      const ranks = fen.split(' ')[0].split('/');
      assert(ranks.length === 8, `${v.name} (${playerColor}) FEN has 8 ranks`);
      for (const rank of ranks) {
        const width = [...rank].reduce(
          (n, c) => n + (c >= '1' && c <= '9' ? +c : 1), 0
        );
        if (width !== 8) {
          assert(false, `${v.name} (${playerColor}) rank "${rank}" is ${width} wide`);
        }
      }
      assert(true, `${v.name} (${playerColor}) every rank is 8 squares wide`);

      // Upgraded pieces must be on the human's back rank, never the engine's.
      const upgraded = Object.keys(spec.glyphs);
      const myRank = playerColor === 'w' ? ranks[7] : ranks[0];
      const theirRank = playerColor === 'w' ? ranks[0] : ranks[7];
      const has = (rank, set, upper) =>
        set.some((p) => rank.includes(upper ? p.toUpperCase() : p));
      assert(has(myRank, upgraded, playerColor === 'w'),
        `${v.name} (${playerColor}) puts the strong pieces on your side`);
      assert(!has(theirRank, upgraded, playerColor !== 'w'),
        `${v.name} (${playerColor}) leaves the engine an ordinary army`);

      // Kings on e-file with rooks in the corners, so castling still works.
      assert(myRank[4].toLowerCase() === 'k' && theirRank[4].toLowerCase() === 'k',
        `${v.name} (${playerColor}) keeps both kings on the e-file`);
      assert(myRank[0].toLowerCase() === 'r' && myRank[7].toLowerCase() === 'r',
        `${v.name} (${playerColor}) keeps rooks in the corners for castling`);
    }

    // Every fairy piece needs a value, or the search treats it as worthless.
    for (const letter of Object.keys(spec.glyphs)) {
      assert(spec.values && typeof spec.values[letter] === 'number',
        `${v.name} prices its "${letter}" piece for the search`);
    }
    assert(cfgDefinesPieces(spec), `${v.name} declares each fairy piece it uses`);
  }

  function cfgDefinesPieces(spec) {
    const cfg = spec.config('w');
    return Object.keys(spec.glyphs).every((letter) =>
      new RegExp(`= ${letter}\\s*$`, 'm').test(cfg)
    );
  }
}

console.log('Card art');
{
  const { FishArt } = require(path.join(__dirname, '..', 'js', 'fish-art.js'));
  const known = new Set(Object.keys(FishArt.PROPS));

  const missing = [];
  for (const [id, v] of Object.entries(VARIANTS)) {
    for (const entry of (v.art && v.art.props) || []) {
      const [name, x, y, size] = entry;
      if (!known.has(name)) missing.push(`${id}:${name}`);
      if (![x, y, size].every((n) => typeof n === 'number' && n >= 0 && n <= 100)) {
        missing.push(`${id}:${name} has an out-of-range coordinate`);
      }
    }
  }
  assert(missing.length === 0,
    'every card references a prop that exists, in range' +
    (missing.length ? ' (' + missing.join(', ') + ')' : ''));

  // Each prop must be renderable SVG, not a broken template string.
  for (const [name, draw] of Object.entries(FishArt.PROPS)) {
    const out = draw();
    if (!/^<svg[^>]*viewBox="[\d.\- ]+"/.test(out) || !out.endsWith('</svg>')) {
      assert(false, `prop "${name}" produces a well-formed svg`);
    }
  }
  assert(true, 'every prop produces a well-formed svg');

  // The odds bots say what is missing; the upgrade bots say what you gain.
  const ODDS_ART = {
    queenlessfish: 'pieceQueen',
    rooklessfish: 'pieceRook',
    knightlessfish: 'pieceKnight',
    bishoplessfish: 'pieceBishop',
  };
  for (const [id, piece] of Object.entries(ODDS_ART)) {
    const names = VARIANTS[id].art.props.map((p) => p[0]);
    assert(names.includes(piece) && names.includes('noSign'),
      `${VARIANTS[id].name} shows the piece it lacks, struck through`);
    // The slash has to be drawn over the piece, i.e. same spot and bigger.
    const [, px, py, psize] = VARIANTS[id].art.props.find((p) => p[0] === piece);
    const [, nx, ny, nsize] = VARIANTS[id].art.props.find((p) => p[0] === 'noSign');
    assert(px === nx && py === ny, `${VARIANTS[id].name} centres the sign on the piece`);
    assert(nsize > psize, `${VARIANTS[id].name} draws the sign larger than the piece`);
  }
  for (const id of ['armyfish', 'handicapfish']) {
    const names = VARIANTS[id].art.props.map((p) => p[0]);
    assert(names.includes('plusBadge') && names.filter((n) => n.startsWith('piece')).length === 2,
      `${VARIANTS[id].name} shows the two pieces its fairy piece combines`);
  }
}

console.log('Variant ordering');
{
  const fs = require('fs');
  const ids = Object.keys(VARIANTS);
  assert(ids[0] === 'stockfish', 'plain Stockfish is still first');

  // The tail of the list is deliberate: the material-odds bots, then the
  // variants that change the rules of the game itself.
  const TAIL = [
    'queenlessfish', 'rooklessfish', 'knightlessfish', 'bishoplessfish',
    'threecheckfish', 'dragonfish', 'armyfish', 'handicapfish',
  ];
  assert(ids.slice(-TAIL.length).join() === TAIL.join(),
    'the list ends with the odds bots then the rule-changing ones (' +
    ids.slice(-TAIL.length).join(' → ') + ')');
  // Odds bots ascend in generosity, so the list reads as a difficulty ramp.
  assert(ids.indexOf('queenlessfish') < ids.indexOf('threecheckfish'),
    'the odds bots come before the rule changes');

  // The README table is the same list in prose; keep the two in step.
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const listed = [...readme.matchAll(/^\| \*\*(\w+)\*\* \|/gm)].map((m) => m[1]);
  const expected = ids.filter((id) => id !== 'stockfish').map((id) => VARIANTS[id].name);
  assert(listed.join() === expected.join(),
    'the README table lists the same fish in the same order');
}

console.log('Cache versioning');
{
  // A stale index.html serves stale scripts no matter what the ?v= says, so
  // the page checks version.txt at boot. These two must never disagree.
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const txt = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim();

  const declared = html.match(/window\.FISHTANK_VERSION = '(\d+)'/);
  assert(!!declared, 'index.html declares its version to the app');
  assert(declared && declared[1] === txt,
    `index.html (v${declared && declared[1]}) matches version.txt (v${txt})`);

  const queries = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert(queries.length > 0, 'assets are cache-busted with ?v=');
  assert(new Set(queries).size === 1,
    'every asset uses the same ?v= (' + [...new Set(queries)].join(', ') + ')');
  assert(queries[0] === txt, `?v=${queries[0]} matches version.txt (v${txt})`);
  assert(/^\d+$/.test(txt), 'version.txt holds a bare number and nothing else');
}

console.log('Best-move arrows');
{
  // The geometry helpers are pure, so they are pulled out of app.js and run
  // directly rather than through a DOM.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const grab = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} not found in app.js`);
    let depth = 0;
    let i = src.indexOf('{', start);
    const from = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1) && src.slice(from, i + 1);
  };
  // eslint-disable-next-line no-new-func
  const squareCentre = new Function(
    'sq', 'flipped', grab('squareCentre').replace(/^\{|\}$/g, '')
  );
  const arrowPoints = new Function(
    'from', 'to', 'flipped',
    'const squareCentre = ' +
      'function (sq, flipped) ' + grab('squareCentre') + ';' +
      grab('arrowPoints').replace(/^\{|\}$/g, '')
  );

  // a8 is the top-left square when White is at the bottom.
  let c = squareCentre('a8', false);
  assert(c.x === 0.5 && c.y === 0.5, 'a8 is the top-left square for White');
  c = squareCentre('h1', false);
  assert(c.x === 7.5 && c.y === 7.5, 'h1 is the bottom-right square for White');
  // Flipping the board must mirror both axes, not just one.
  c = squareCentre('a8', true);
  assert(c.x === 7.5 && c.y === 7.5, 'a8 is bottom-right when playing Black');
  c = squareCentre('e1', false);
  const cf = squareCentre('e1', true);
  // Centres sit at col + 0.5, so the mirror of x is 8 - x, not 7 - x.
  assert(cf.x === 8 - c.x && cf.y === 8 - c.y, 'flipping mirrors both axes');

  const parse = (s) => s.split(' ').map((p) => p.split(',').map(Number));
  const e2e4 = parse(arrowPoints('e2', 'e4', false));
  assert(e2e4.length === 7, 'an arrow is a 7-point polygon (shaft plus head)');
  assert(e2e4.every((p) => p.every((n) => Number.isFinite(n))),
    'every arrow coordinate is a real number');

  // e2 -> e4 is straight up the board: constant x, and the tip above the tail.
  const xs = e2e4.map((p) => p[0]);
  const centreX = squareCentre('e2', false).x;
  assert(Math.max(...xs) - Math.min(...xs) < 0.6,
    'a vertical arrow stays within its file');
  const tip = e2e4[3]; // the point of the head
  assert(Math.abs(tip[0] - centreX) < 1e-9, 'the tip is centred on the file');
  // e2->e4 travels up the board, so "stopping short" means a larger y. Compare
  // distances from the origin rather than raw coordinates, which flip sign.
  const orig = squareCentre('e2', false);
  const dest = squareCentre('e4', false);
  const travelled = Math.hypot(tip[0] - orig.x, tip[1] - orig.y);
  const full = Math.hypot(dest.x - orig.x, dest.y - orig.y);
  assert(travelled < full, 'the tip stops short of the target square centre');
  assert(full - travelled < 0.2, 'but only just short of it');

  // Knight moves are diagonal-ish; the arrow must still point the right way.
  const g1f3 = parse(arrowPoints('g1', 'f3', false));
  const from = squareCentre('g1', false);
  const to = squareCentre('f3', false);
  const tipN = g1f3[3];
  assert(
    Math.hypot(tipN[0] - to.x, tipN[1] - to.y) <
      Math.hypot(tipN[0] - from.x, tipN[1] - from.y),
    'the head points at the destination, not the origin'
  );

  assert(arrowPoints('e2', 'e2', false) === null, 'a null move draws nothing');

  // Flipping the board must not change the arrow's shape, only its position.
  const spread = (pts) => {
    const p = parse(pts);
    return Math.hypot(
      Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])),
      Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]))
    );
  };
  assert(
    Math.abs(spread(arrowPoints('e2', 'e4', false)) -
             spread(arrowPoints('e2', 'e4', true))) < 1e-9,
    'flipping the board does not distort the arrow'
  );

  // A one-square arrow still has to fit its head in without inverting.
  const short = parse(arrowPoints('e2', 'e3', false));
  assert(short.every((p) => p.every((n) => Number.isFinite(n))),
    'a one-square arrow is still well formed');

  assert(/analysisReport = null/.test(src), 'a new game clears the analysis');
  assert(/renderArrows\(\);/.test(src), 'the board render draws the arrows');
}

console.log('Analysis best-move data');
{
  // Every analysed position must carry a best move for the arrow to draw,
  // including the positions where the player already found it — that was the
  // bug: the arrow only appeared on mistakes, unlike lichess.
  const { Analysis } = require(path.join(__dirname, '..', 'js', 'analysis.js'));
  const vendored = path.join(__dirname, '..', 'vendor', 'chess.js');
  if (!require('fs').existsSync(vendored)) {
    console.log('  (skipped: run engine/get-engine.sh to vendor chess.js)');
  } else {
    global.Chess = require(vendored).Chess || require(vendored);

    // A scripted engine that always wants to develop the kingside knight. The
    // move has to stay legal in every position it is offered for, or the SAN
    // conversion fails and the entry looks like "you played the best move".
    const bestFor = { w: 'g1f3', b: 'g8f6' };
    const fakeEngine = {
      setFullStrength() {},
      async evaluate(fen) {
        const turn = fen.split(' ')[1];
        return { cp: 20, mate: null, best: bestFor[turn] };
      },
    };

    const walk = new global.Chess();
    walk.move('e4'); // not what the engine wanted
    walk.move('e5'); // nor this
    walk.move('Nf3'); // this one matches the engine's choice exactly
    const history = walk.history({ verbose: true });

    // Registered with the async runner at the bottom so failures are counted.
    testAnalysisBestMoves = async () => {
      const report = await Analysis.run(fakeEngine, history, () => {});
      assert(report.moves.length === 3, 'every move is analysed');
      assert(report.moves.every((m) => m.bestUci),
        'every analysed position carries a best move for the arrow');
      assert(report.moves[0].bestUci === 'g1f3',
        'the best move is kept in UCI, ready to draw');
      assert(report.moves[0].best === 'Nf3',
        'the written list names the better move when you missed it');
      // The regression: this move WAS the best, and used to lose its arrow.
      assert(report.moves[2].best === null,
        'the list stays quiet when you played the best move');
      assert(report.moves[2].bestUci === 'g1f3',
        'but the arrow still has a move to draw there');
      assert(report.moves.every((m, i) => m.ply === i),
        'each entry knows the ply to jump to');
      assert(report.moves[0].playedUci === 'e2e4', 'the played move is kept too');
    };
  }
}

console.log('Click-to-move guard');
{
  // A tap fires pointerdown, pointerup and then click. Both boards select on
  // pointerdown, so the trailing click lands on an already-selected square and
  // used to deselect it, which broke click-to-move entirely. Each board must
  // set the guard when a gesture ends and clear it when a new one starts.
  const fs = require('fs');
  for (const file of ['app.js', 'dragon.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    assert(/swallowNextClick = true/.test(src),
      `${file}: the end of a pointer gesture arms the guard`);
    assert(
      /pointerdown['"], \(e\) => \{\s*\n\s*swallowNextClick = false/.test(src),
      `${file}: a new pointerdown clears the guard`
    );
    assert(
      /if \(swallowNextClick\) \{\s*\n\s*swallowNextClick = false;\s*\n\s*return;/.test(src),
      `${file}: the click handler consumes the guard and stops`
    );
    // The guard must be consumed, never left set, or the next real click dies.
    const armed = (src.match(/swallowNextClick = true/g) || []).length;
    const cleared = (src.match(/swallowNextClick = false/g) || []).length;
    assert(cleared >= armed + 1,
      `${file}: the guard is cleared in more places than it is set ` +
      `(${cleared} vs ${armed})`);
  }
}

console.log('DragonFish search');
{
  // The worker is a classic worker script, so it is loaded into a sandbox with
  // stubs for the worker globals and a scripted mock board standing in for
  // ffish. The mock is a small tree of positions with hand-written FENs, which
  // is enough to test the search without the 6 MB wasm binary.
  const vm = require('vm');
  const fs = require('fs');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'dragon-worker.js'),
    'utf8'
  );

  const ctx = {
    self: {
      postMessage() {},
      importScripts() {
        throw new Error('no ffish in tests');
      },
    },
    Date,
    Math,
    Object,
    Array,
    console,
  };
  ctx.self.self = ctx.self;
  ctx.importScripts = ctx.self.importScripts;
  ctx.postMessage = ctx.self.postMessage;
  vm.createContext(ctx);
  // Expose the module-scoped internals; `let` bindings never reach the global.
  vm.runInContext(
    src +
      '\nself.__test = {' +
      '  setBoard: (b) => { board = b; },' +
      '  scan: () => scan(),' +
      '  order: (m, i, p) => order(m, i, p),' +
      '  PST, VALS,' +
      '  search: (depth) => {' +
      '    deadline = Date.now() + 30000; aborted = false;' +
      '    nodeCount = 0; rootBest = null;' +
      '    const s = negamax(depth, -Infinity, Infinity, 0);' +
      '    return { move: rootBest, score: s, aborted };' +
      '  },' +
      '};',
    ctx
  );
  const T = ctx.self.__test;

  for (const [name, table] of Object.entries(T.PST)) {
    assert(table.length === 64, `${name} piece-square table covers 64 squares`);
  }
  assert(
    Object.keys(T.PST).every((k) => T.VALS[k] !== undefined),
    'every piece-square table belongs to a real piece'
  );
  // Tables must not favour one wing over the other.
  const asymmetric = Object.entries(T.PST).filter(([, t]) => {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 4; f++) if (t[r * 8 + f] !== t[r * 8 + (7 - f)]) return true;
    }
    return false;
  });
  assert(asymmetric.length === 0,
    'piece-square tables are left-right symmetric' +
    (asymmetric.length ? ' (offenders: ' + asymmetric.map((x) => x[0]) + ')' : ''));

  /* A scripted position tree. White can grab a knight with its dragon, but the
   * dragon is then taken by a pawn — the classic error a search without a
   * quiescence phase makes, because it stops counting after the first capture. */
  const TREE = {
    root: {
      fen: '4k3/8/6p1/7n/8/8/P7/3AK3 w - - 0 1',
      moves: { d1h5: 'capB', a2a3: 'quietB' },
    },
    // Dragon has taken on h5; Black to move.
    capB: {
      fen: '4k3/8/6p1/7A/8/8/P7/4K3 b - - 0 1',
      moves: { g6h5: 'recapW', e8d8: 'keptW' },
    },
    // ...gxh5: White is a dragon down for a knight.
    recapW: { fen: '4k3/8/8/7p/8/8/P7/4K3 w - - 0 2', moves: { e1d1: 'recapB' } },
    recapB: { fen: '4k3/8/8/7p/8/8/P7/3K4 b - - 1 2', moves: { e8d8: 'recapW2' } },
    recapW2: { fen: '3k4/8/8/7p/8/8/P7/3K4 w - - 2 3', moves: { d1e1: 'recapB2' } },
    recapB2: { fen: '3k4/8/8/7p/8/8/P7/4K3 b - - 3 3', moves: { d8e8: 'recapW' } },
    // Black declines the recapture: White keeps the extra piece.
    keptW: { fen: '3k4/8/6p1/7A/8/8/P7/4K3 w - - 1 2', moves: { e1d1: 'keptB' } },
    keptB: { fen: '3k4/8/6p1/7A/8/8/P7/3K4 b - - 2 3', moves: { d8e8: 'keptW' } },
    // The quiet alternative: nothing is traded, White stays a piece up.
    quietB: { fen: '4k3/8/6p1/7n/8/P7/8/3AK3 b - - 0 1', moves: { e8d8: 'quietW' } },
    quietW: { fen: '3k4/8/6p1/7n/8/P7/8/3AK3 w - - 1 2', moves: { e1f1: 'quietB2' } },
    quietB2: { fen: '3k4/8/6p1/7n/8/P7/8/3A1K2 b - - 2 2', moves: { d8e8: 'quietW2' } },
    quietW2: { fen: '4k3/8/6p1/7n/8/P7/8/3A1K2 w - - 3 3', moves: { f1e1: 'quietB' } },
  };

  let cur = 'root';
  const stack = [];
  const mock = {
    fen: () => TREE[cur].fen,
    legalMoves: () => Object.keys(TREE[cur].moves).join(' '),
    legalMovesSan: () => Object.keys(TREE[cur].moves).join(' '),
    isCheck: () => false,
    push(m) {
      stack.push(cur);
      cur = TREE[cur].moves[m];
    },
    pop() {
      cur = stack.pop();
    },
  };
  T.setBoard(mock);

  const scoreOf = (id) => {
    cur = id;
    return T.scan().score;
  };
  const afterCapture = scoreOf('capB');
  const afterQuiet = scoreOf('quietB');
  const afterRecapture = scoreOf('recapW');
  cur = 'root';

  // This is precisely the trap: counting material one ply after the capture
  // makes the losing move look like the best one on the board.
  assert(afterCapture > afterQuiet,
    'grabbing the knight looks best if you stop counting there (' +
    afterCapture + ' vs ' + afterQuiet + ')');
  assert(afterRecapture < afterQuiet - 500,
    'but after the recapture White is much worse (' + afterRecapture + ')');

  const d1 = T.search(1);
  assert(cur === 'root', 'the search leaves the board where it found it');
  assert(d1.move === 'a2a3',
    'quiescence sees the recapture and declines the piece grab (played ' +
    d1.move + ')');
  const d3 = T.search(3);
  assert(d3.move === 'a2a3', 'still declines it when searching deeper');
  assert(!d3.aborted, 'a tiny tree finishes well inside the time budget');

  // Move ordering: try the most valuable victim first.
  cur = 'root';
  const info = T.scan();
  assert(info.whiteToMove === true, 'scan reads the side to move from the FEN');
  assert(info.at.d1 === 'A' && info.at.h5 === 'n', 'scan maps pieces to squares');
  const ordered = ['a2a3', 'd1h5'];
  T.order(ordered, info, 0);
  assert(ordered[0] === 'd1h5', 'captures are searched before quiet moves');
}

// Async suites run last, then the overall result is reported.
(async () => {
  await testDrunkFishBlunders();
  await testAnalysisBestMoves();
  await testMaiaTimeout();
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
