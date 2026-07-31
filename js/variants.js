/*
 * FishTank — emotionally unstable Stockfish variants.
 * Each variant defines how the engine's effective Elo changes during the game.
 *
 * Elo model:
 *   - We track an effective elo in [100, 3190].
 *   - The engine always searches at full strength; the rating decides how much
 *     evaluation the bot is willing to throw away when picking its move
 *     (see the bounded-loss model in engine.js).
 *   - Every search is time-limited, never depth-limited.
 */

const ELO_MIN = 1320; // Stockfish's own UCI_Elo floor
const ELO_MAX = 3190; // Stockfish's own UCI_Elo ceiling
const ELO_FLOOR = 100; // our floor: below this a rating is meaningless

/** Keep an effective Elo inside [ELO_FLOOR, ELO_MAX]. */
function clampElo(elo) {
  return Math.max(ELO_FLOOR, Math.min(ELO_MAX, elo));
}

/**
 * Chance of a completely random (non-engine) move.
 *
 * Strength is handled by the engine's bounded-loss model (engine.js), which
 * already produces plausible bad moves. Only the very bottom of the scale
 * keeps a little pure chaos, for bots like RageFish that start near 100.
 */
function randomMoveProbability(effectiveElo) {
  if (effectiveElo >= 250) return 0;
  return Math.min(0.12, ((250 - effectiveElo) / 250) * 0.12);
}

/*
 * Variant hook contract (all optional):
 *   init(state)                          -> called at game start
 *   onPlayerMove(state, move, game)      -> after the human moves; may return event strings
 *   onEngineTurnStart(state, game)       -> before the engine thinks; may return event strings
 *   onEngineMovePlayed(state, move, game)-> after the engine's move; may return event strings
 *   onPlayerMoveAsync(state, ctx)        -> async version of onPlayerMove, with engine access;
 *                                           ctx = { move, game, engine, fenBefore, legalCount }
 *   pickMove(state, ctx)                 -> choose the engine's move yourself (async);
 *                                           ctx = { game, engine, fen, legalCount };
 *                                           return { uci, events } or null to fall through
 *   eloLabel(state)                      -> replace the Elo readout with custom text
 *   extraRandomChance(state, game)       -> additional probability [0,1] of a random move
 *   checkCustomEnd(state, game)          -> return { winner: 'player'|'engine'|'draw', msg }
 *                                           to end the game with a custom rule
 *
 * state = { elo, moveCount, playerColor, ...variant scratch }
 */

/** Count the player's pieces standing on the engine's half of the board. */
function countInvaders(game, playerColor) {
  let n = 0;
  for (const f of 'abcdefgh') {
    for (let r = 1; r <= 8; r++) {
      const p = game.get(f + r);
      if (p && p.color === playerColor) {
        if (playerColor === 'w' ? r >= 5 : r <= 4) n++;
      }
    }
  }
  return n;
}

const VARIANTS = {
  stockfish: {
    id: 'stockfish',
    name: 'Stockfish',
    emoji: '🐟',
    tagline: 'The real thing. Full strength, no gimmicks.',
    description:
      'Plain Stockfish at its maximum limiter setting (3190 Elo). ' +
      'Its strength never changes. Good luck.',
    baseElo: ELO_MAX,
    demo: [['♗d3', '3190', ''], ['♔e2', '3190', ''], ['♕g4', '3190', '']],
    art: { props: [] },
  },

  panicfish: {
    id: 'panicfish',
    name: 'PanicFish',
    emoji: '😱',
    tagline: 'Loses 300 Elo every time you check its king.',
    description: 'Starts at 3190 Elo. Loses 300 Elo each time you give check.',
    baseElo: ELO_MAX,
    demo: [['♗b5+', '2890', '−300'], ['♕h5+', '2590', '−300'], ['♖e8+', '2290', '−300']],
    art: { anim: 'shake', props: [['alarmBell', 66, 24, 28, 12], ['exclaim', 84, 54, 11, 8], ['sweat', 34, 62, 12, -25], ['sweat', 62, 68, 10, 20]] },
    onPlayerMove(state, move, game) {
      if (game.in_check()) {
        state.elo = clampElo(state.elo - 300);
        return [`♚ Check: −300 Elo → ${state.elo}`];
      }
    },
  },

  tiltfish: {
    id: 'tiltfish',
    name: 'TiltFish',
    emoji: '🤬',
    tagline: 'Loses 200 Elo every time you capture one of its pieces.',
    description: 'Starts at 3190 Elo. Loses 200 Elo each time you capture one of its pieces.',
    baseElo: ELO_MAX,
    demo: [['♞xd4', '2990', '−200'], ['♝xf3', '2790', '−200'], ['♜xa2', '2590', '−200']],
    art: { filter: 'saturate(1.7) hue-rotate(-18deg)', anim: 'shake', props: [['tableFlip', 68, 32, 50, 0], ['angerVeins', 36, 70, 16, 0]] },
    onPlayerMove(state, move) {
      if (move.captured) {
        state.elo = clampElo(state.elo - 200);
        return [
          `${pieceName(move.captured)} captured: −200 Elo → ${state.elo}`,
        ];
      }
    },
  },

  tiredfish: {
    id: 'tiredfish',
    name: 'TiredFish',
    emoji: '😴',
    tagline: 'Loses 50 Elo every move it plays.',
    description: 'Starts at 3190 Elo. Loses 50 Elo after every move it plays.',
    baseElo: ELO_MAX,
    demo: [['♗d3', '3140', '−50'], ['♔e2', '3090', '−50'], ['♕g4', '3040', '−50']],
    art: { props: [['nightcap', 41, 72, 34, -32], ['zzz', 66, 34, 22, 0]] },
    onEngineTurnStart(state) {
      if (state.moveCount > 0) {
        state.elo = clampElo(state.elo - 50);
        return [`😴 −50 Elo → ${state.elo}`];
      }
    },
  },

  drunkfish: {
    id: 'drunkfish',
    name: 'DrunkFish',
    emoji: '🍺',
    tagline: 'Full strength, but blunders 5% of the time.',
    description: 'Plays at 3190 Elo. Every move has a flat 5% chance of being a blunder.',
    baseElo: ELO_MAX,
    demo: [['♗d3', 'best', ''], ['♔e2', 'best', ''], ['♞a3', '??', '🍺']],
    art: { anim: 'wobble', props: [['beerMug', 70, 60, 28, 8], ['sunglasses', 53, 82, 30, -35]] },
    blunderChance: 0.05,
    // A blunder has to actually cost something: a random legal move is often
    // just a harmless shuffle, so instead the engine ranks every move and one
    // of the genuinely bad ones is played. Only the 5% of moves that trigger
    // pay for the extra search.
    async pickMove(state, ctx) {
      if (Math.random() >= this.blunderChance) return null; // sober: play normally
      const ranked = await ctx.engine.rankMoves(ctx.fen, ctx.legalCount);
      if (!ranked || ranked.length < 2) return null;

      const best = ranked[0].score;
      const bad = ranked.filter((r) => best - r.score >= 200);
      // Nothing bad enough available (forced or dead-drawn): take the worst
      // there is rather than pretending to blunder.
      const pool = bad.length ? bad : [ranked[ranked.length - 1]];
      const choice = pool[Math.floor(Math.random() * pool.length)];
      const lost = ((best - choice.score) / 100).toFixed(1);
      return {
        uci: choice.move,
        events: [`🍺 DrunkFish blunders — throws away ${lost} pawns`],
      };
    },
  },

  ragefish: {
    id: 'ragefish',
    name: 'RageFish',
    emoji: '😡',
    tagline: 'Starts at 200 Elo. Gains 200 every time you capture one of its pieces.',
    description:
      'Starts at 200 Elo, playing mostly random moves. Gains 200 Elo each time ' +
      'you capture one of its pieces (max 3190).',
    baseElo: 200,
    demo: [['♟xe5', '400', '+200'], ['♞xc3', '600', '+200'], ['♝xb2', '800', '+200']],
    art: { filter: 'saturate(2.2) hue-rotate(-35deg) contrast(1.1)', anim: 'shake', props: [['devilHorns', 42, 71, 34, -30], ['angerVeins', 68, 52, 16, 0]] },
    onPlayerMove(state, move) {
      if (move.captured) {
        state.elo = clampElo(state.elo + 200);
        return [
          `${pieceName(move.captured)} captured: +200 Elo → ${state.elo}`,
        ];
      }
    },
  },

  gamblerfish: {
    id: 'gamblerfish',
    name: 'GamblerFish',
    emoji: '🎰',
    tagline: 'Re-rolls its Elo every 3 moves.',
    description:
      'Every 3 moves it rolls a new Elo, uniformly between 1320 and 3190, and ' +
      'plays at that strength until the next roll.',
    baseElo: Math.round((ELO_MIN + ELO_MAX) / 2),
    demo: [['♗d3', '1447', '🎲'], ['♔e2', '1447', ''], ['♕g4', '3102', '🎲']],
    // Sunglasses sit on the eye (~62%, 80% of the fish stage), not beside it.
    art: { anim: 'bob', props: [['sunglasses', 62, 80, 32, -20], ['dice', 72, 26, 19, 15], ['dice', 86, 58, 14, -12]] },
    onEngineTurnStart(state) {
      // Roll on its 1st, 4th, 7th... move, then hold that rating in between.
      if (state.moveCount % 3 !== 0) return;
      state.elo = ELO_MIN + Math.floor(Math.random() * (ELO_MAX - ELO_MIN + 1));
      return [`🎰 Rolled ${state.elo} Elo — playing at this strength for 3 moves`];
    },
  },

  sharkfish: {
    id: 'sharkfish',
    name: 'SharkFish',
    emoji: '🦈',
    tagline: 'Gains 150 Elo every time it checks YOUR king.',
    description: 'Starts at 1600 Elo. Gains 150 Elo each time it gives check (max 3190).',
    baseElo: 1600,
    demo: [['♗b5+', '1750', '+150'], ['♕h5+', '1900', '+150'], ['♖e8+', '2050', '+150']],
    art: { filter: 'grayscale(0.5) contrast(1.1)', props: [['sharkTeeth', 47, 88, 32, -35], ['sharkFin', 58, 56, 24, -20]] },
    onEngineMovePlayed(state, move, game) {
      if (game.in_check()) {
        state.elo = clampElo(state.elo + 150);
        return [`🦈 Check given: +150 Elo → ${state.elo}`];
      }
    },
  },

  pacifistfish: {
    id: 'pacifistfish',
    name: 'PacifistFish',
    emoji: '🕊️',
    tagline: 'Loses 300 Elo every time IT captures one of your pieces.',
    description: 'Starts at 3190 Elo. Loses 300 Elo each time it captures one of your pieces.',
    baseElo: ELO_MAX,
    demo: [['♗xf6', '2890', '−300'], ['♘xd5', '2590', '−300'], ['♕xh7', '2290', '−300']],
    art: { props: [['halo', 43, 68, 40, -25], ['flower', 58, 80, 13, 0]] },
    onEngineMovePlayed(state, move) {
      if (move && move.captured) {
        state.elo = clampElo(state.elo - 300);
        return [
          `🕊️ It captured your ${pieceName(move.captured)}: −300 Elo → ${state.elo}`,
        ];
      }
    },
  },

  drawfish: {
    id: 'drawfish',
    name: 'DrawFish',
    emoji: '🤝',
    tagline: 'Always plays the move that keeps the evaluation closest to 0.00.',
    description:
      'Searches every legal move at full strength and plays whichever one ' +
      'leaves the position nearest to dead equal. It is not trying to beat ' +
      'you — it is trying to draw. To win, you have to make equality impossible.',
    baseElo: ELO_MAX,
    eloLabel: () => '0.00',
    demo: [['♗d3', '+0.04', ''], ['♔e2', '−0.02', ''], ['♕g4', '0.00', '']],
    art: { props: [['scales', 66, 30, 42, 0], ['equalsBadge', 52, 82, 20, 0]] },
    async pickMove(state, ctx) {
      const ranked = await ctx.engine.rankMoves(ctx.fen, ctx.legalCount);
      if (!ranked || !ranked.length) return null;
      let choice = ranked[0];
      for (const r of ranked) {
        if (Math.abs(r.score) < Math.abs(choice.score)) choice = r;
      }
      const evalText = (choice.score / 100).toFixed(2);
      return {
        uci: choice.move,
        events: [`🤝 Nearest to equality: eval ${choice.score > 0 ? '+' : ''}${evalText}`],
      };
    },
  },

  worstfish: {
    id: 'worstfish',
    name: 'WorstFish',
    emoji: '💀',
    tagline: 'Always plays the worst legal move in the position.',
    description:
      'Searches every legal move at full strength and plays the one with the ' +
      'lowest evaluation. It hangs everything, walks into mate, and refuses ' +
      'any good move. Losing to it is an achievement.',
    baseElo: ELO_MAX,
    eloLabel: () => 'worst',
    demo: [['♖a8??', '−9.4', '↓'], ['♕xh7??', '−12.1', '↓'], ['♔e2??', '#−3', '↓']],
    art: { filter: 'grayscale(0.7)', anim: 'wobble', props: [['dunceCap', 41, 68, 24, -28], ['skull', 72, 60, 21, 8]] },
    async pickMove(state, ctx) {
      const ranked = await ctx.engine.rankMoves(ctx.fen, ctx.legalCount);
      if (!ranked || !ranked.length) return null;
      const choice = ranked[ranked.length - 1]; // rankMoves is best-first
      const evalText = (choice.score / 100).toFixed(2);
      return {
        uci: choice.move,
        events: [`💀 Worst move available: eval ${choice.score > 0 ? '+' : ''}${evalText}`],
      };
    },
  },

  pityfish: {
    id: 'pityfish',
    name: 'PityFish',
    emoji: '😢',
    tagline: 'Loses 500 Elo every time you play the worst move on the board.',
    description:
      'Starts at 3190 Elo. Every time your move is the single worst legal ' +
      'move in the position, it feels so sorry for you that it loses 500 Elo. ' +
      'Blunder deliberately at your own risk.',
    baseElo: ELO_MAX,
    demo: [['♖a8??', '2690', '−500'], ['♕xh7??', '2190', '−500'], ['♘g1??', '1690', '−500']],
    art: { props: [['tears', 54, 84, 15, -30], ['tissueBox', 72, 58, 26, -6]] },
    /** Needs the engine to rank every legal move, so this hook is async. */
    async onPlayerMoveAsync(state, ctx) {
      const { move, engine, fenBefore, legalCount } = ctx;
      if (!engine || legalCount < 2) return;
      const ranking = await engine.rankWorstMove(fenBefore, legalCount);
      if (!ranking || !ranking.worst) return;
      const played = move.from + move.to + (move.promotion || '');
      const worst = ranking.worst;
      // Compare ignoring promotion suffix mismatches (e.g. "e7e8q" vs "e7e8").
      if (played === worst || played.slice(0, 4) === worst.slice(0, 4)) {
        state.elo = clampElo(state.elo - 500);
        return [`😢 ${move.san} was the worst move available: −500 Elo → ${state.elo}`];
      }
    },
  },

  cowardfish: {
    id: 'cowardfish',
    name: 'CowardFish',
    emoji: '🙈',
    tagline: 'Loses 400 Elo for each of your pieces on its half of the board.',
    description:
      'Plays at 3190 Elo minus 400 for each of your pieces currently on its ' +
      'half of the board. Recovers as they leave.',
    baseElo: ELO_MAX,
    demo: [['♙e5', '2790', '−400'], ['♘f5', '2390', '−400'], ['♕h5', '1990', '−400']],
    art: { anim: 'shake', props: [['whiteFlag', 66, 40, 32, 10], ['sweat', 44, 70, 12, -20]] },
    onEngineTurnStart(state, game) {
      const invaders = countInvaders(game, state.playerColor);
      state.elo = clampElo(this.baseElo - 400 * invaders);
      if (invaders !== (state.lastInvaders || 0)) {
        state.lastInvaders = invaders;
        if (invaders > 0) {
          return [
            `🙈 ${invaders} of your piece${invaders === 1 ? '' : 's'} on its half: Elo → ${state.elo}`,
          ];
        }
        return [`🙈 No invaders on its half: Elo → ${state.elo}`];
      }
    },
  },

  oddsfish: {
    id: 'oddsfish',
    name: 'OddsFish',
    emoji: '♛',
    tagline: 'Full strength, but it starts without its queen.',
    description:
      'Plain 3190 Elo Stockfish, playing the classical handicap: it begins ' +
      'the game a queen down. No mood swings — you just have nine points ' +
      'of material and have to convert them.',
    baseElo: ELO_MAX,
    demo: [['♗d3', '3190', ''], ['♔e2', '3190', ''], ['♕—', 'odds', '']],
    art: { props: [['crown', 62, 34, 30, -12], ['whiteFlag', 34, 74, 24, 14]] },
    /**
     * Standard chess from a lopsided position: the *engine* loses its queen,
     * whichever colour it ends up playing. White still moves first.
     */
    startFen(playerColor) {
      return playerColor === 'w'
        ? 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1';
    },
  },

  handicapfish: {
    id: 'handicapfish',
    name: 'HandicapFish',
    emoji: '🐲',
    fairy: true,
    tagline: 'Your queen is a dragon. Its queen is just a queen.',
    description:
      'Standard chess except that your queen moves like a queen and a knight ' +
      'combined, while the engine keeps an ordinary queen. Rules by ' +
      'Fairy-Stockfish. Beta — the opponent is the built-in search.',
    baseElo: null,
    demo: [['🐲d5', '♕+♘', ''], ['🐲xf7+', 'fork', ''], ['♕d8', 'plain', '']],
    art: { filter: 'hue-rotate(15deg) saturate(1.2)', props: [['dragonWing', 68, 38, 34, -10], ['crown', 38, 74, 26, -18]] },
    fairySpec: {
      variantName: 'handicap',
      glyphs: { a: '🐲' },
      values: { a: 1150 }, // amazon: queen + knight
      // Defined at runtime through ffish.loadVariantConfig, so no rebuild of
      // the engine is needed. Inherits everything from chess and just adds the
      // amazon piece plus a lopsided starting position.
      config(playerColor) {
        const white = 'RNBAKBNR';
        const black = 'rnbakbnr';
        const fen =
          playerColor === 'w'
            ? `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/${white} w KQkq - 0 1`
            : `${black}/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`;
        return `[handicap:chess]\namazon = a\nstartFen = ${fen}\n`;
      },
    },
  },

  armyfish: {
    id: 'armyfish',
    name: 'ArmyFish',
    emoji: '🦅',
    fairy: true,
    tagline: 'Your knights are chancellors and your bishops are archbishops.',
    description:
      'Your minor pieces are upgraded: knights become chancellors (rook + ' +
      'knight) and bishops become archbishops (bishop + knight). The engine ' +
      'gets an ordinary army. Rules by Fairy-Stockfish. Beta — the opponent ' +
      'is the built-in search.',
    baseElo: null,
    demo: [['🏰b3', '♖+♘', ''], ['🦅c4', '♗+♘', ''], ['♘g1', 'plain', '']],
    art: { filter: 'saturate(1.25)', props: [['shield', 68, 40, 32, 8], ['crown', 36, 74, 24, -16], ['checkMarks', 88, 62, 12, 0]] },
    fairySpec: {
      variantName: 'army',
      glyphs: { c: '🏰', a: '🦅' },
      // Here 'a' is the archbishop, not the amazon — without this override the
      // search would price an archbishop like a queen-and-knight.
      values: { a: 800, c: 900 },
      config(playerColor) {
        const upgraded = 'RCAQKACR'; // rook, chancellor, archbishop, queen, king...
        const fen =
          playerColor === 'w'
            ? `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/${upgraded} w KQkq - 0 1`
            : `${upgraded.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`;
        return (
          '[army:chess]\narchbishop = a\nchancellor = c\n' +
          `startFen = ${fen}\n`
        );
      },
    },
  },

  threecheckfish: {
    id: 'threecheckfish',
    name: 'ThreeCheckFish',
    emoji: '✅',
    tagline: 'Three-check rules: whoever gives three checks first wins.',
    description:
      'Plays at a fixed 2200 Elo under three-check rules: the first side to ' +
      'deliver three checks wins, checkmate also counts. It plays normal ' +
      'chess and does not understand the rule — exploit that.',
    baseElo: 2200,
    demo: [['♗b5+', '✓', '+1'], ['♕h5+', '✓✓', '+1'], ['♖e8+', '✓✓✓', 'win']],
    art: { props: [['checkMarks', 74, 44, 18, 0]] },
    init(state) {
      state.playerChecks = 0;
      state.engineChecks = 0;
    },
    onPlayerMove(state, move, game) {
      if (game.in_check()) {
        state.playerChecks += 1;
        return [`✅ Check ${state.playerChecks}/3 for you`];
      }
    },
    onEngineMovePlayed(state, move, game) {
      if (game.in_check()) {
        state.engineChecks += 1;
        return [`⚠️ Check ${state.engineChecks}/3 for ThreeCheckFish`];
      }
    },
    checkCustomEnd(state) {
      if (state.playerChecks >= 3) {
        return { winner: 'player', msg: '🏆 Three checks — you win!' };
      }
      if (state.engineChecks >= 3) {
        return { winner: 'engine', msg: '💀 ThreeCheckFish delivered three checks — it wins.' };
      }
    },
    kingLives(state, game) {
      // Lives badge on each king: 3 minus checks received. A checkmated king
      // drops straight to 0 regardless of the check count.
      let playerLives = 3 - (state.engineChecks || 0);
      let engineLives = 3 - (state.playerChecks || 0);
      if (game && game.in_checkmate()) {
        if (game.turn() === state.playerColor) playerLives = 0;
        else engineLives = 0;
      }
      return state.playerColor === 'w'
        ? { w: playerLives, b: engineLives }
        : { w: engineLives, b: playerLives };
    },
  },

  dragonfish: {
    id: 'dragonfish',
    name: 'DragonFish',
    emoji: '🐉',
    fairy: true,
    tagline: 'Dragon chess: each queen is a dragon that also moves like a knight.',
    description:
      'Amazon chess, with rules from Fairy-Stockfish: both queens are dragons ' +
      '(queen + knight movement). Beta — the opponent is a built-in search, ' +
      'not the full engine, so it is beatable.',
    baseElo: null,
    demo: [['🐉d5', '♕+♘', ''], ['🐉xf7+', 'fork', '🎲'], ['🐉g6#', 'mate', '']],
    art: { filter: 'hue-rotate(35deg) saturate(1.3)', props: [['dragonWing', 66, 40, 40, -10], ['devilHorns', 42, 71, 32, -30], ['flame', 32, 86, 15, 12]] },
  },
};

function pieceName(p) {
  return (
    { p: '♟ Pawn', n: '♞ Knight', b: '♝ Bishop', r: '♜ Rook', q: '♛ Queen', k: '♚ King' }[p] || p
  );
}

// Export for node-based tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VARIANTS, randomMoveProbability, clampElo, countInvaders,
    ELO_MIN, ELO_MAX, ELO_FLOOR,
  };
}
