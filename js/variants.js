/*
 * FishTank — emotionally unstable Stockfish variants.
 * Each variant defines how the engine's effective Elo changes during the game.
 *
 * Elo model:
 *   - Real Stockfish supports UCI_LimitStrength + UCI_Elo in [1320, 3190].
 *   - We track an unbounded "effective elo". Within range it maps straight to
 *     UCI_Elo. Below 1320 the app switches to Skill Level + shallow fixed
 *     search depth (see engine.js), which plays like a genuinely weak human.
 *     Only far below the floor does a small random-move chance kick in.
 */

const ELO_MIN = 1320;
const ELO_MAX = 3190;

/**
 * Small residual chance of a totally random move at very low effective Elo.
 * Skill Level + depth limiting (engine.js) do most of the weakening; this
 * only adds occasional chaos below ~700 to mimic true-beginner howlers.
 */
function randomMoveProbability(effectiveElo) {
  if (effectiveElo >= 700) return 0;
  return Math.min(0.3, ((700 - effectiveElo) / 700) * 0.3);
}

function clampUciElo(effectiveElo) {
  return Math.max(ELO_MIN, Math.min(ELO_MAX, Math.round(effectiveElo)));
}

/*
 * Variant hook contract (all optional):
 *   init(state)                          -> called at game start
 *   onPlayerMove(state, move, game)      -> after the human moves; may return event strings
 *   onEngineTurnStart(state, game)       -> before the engine thinks; may return event strings
 *   onEngineMovePlayed(state, move, game)-> after the engine's move; may return event strings
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
  panicfish: {
    id: 'panicfish',
    name: 'PanicFish',
    emoji: '😱',
    tagline: 'Loses 200 Elo every time you check its king.',
    description: 'Starts at 3190 Elo. Loses 200 Elo each time you give check.',
    baseElo: ELO_MAX,
    demo: [['♗b5+', '2990', '−200'], ['♕h5+', '2790', '−200'], ['♖e8+', '2590', '−200']],
    art: { anim: 'shake', acc: [['💦',27,6,1.4,20],['💦',7,32,1.1,-15],['❗',40,10,1.3,0]] },
    onPlayerMove(state, move, game) {
      if (game.in_check()) {
        state.elo -= 200;
        return [`♚ Check: −200 Elo → ${state.elo}`];
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
    art: { filter: 'saturate(1.8) hue-rotate(-25deg)', anim: 'shake', acc: [['💢',30,8,1.6,0]] },
    onPlayerMove(state, move) {
      if (move.captured) {
        state.elo -= 200;
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
    art: { transform: 'rotate(38deg)', acc: [['💤',28,6,1.5,0],['💤',14,20,1.1,0]] },
    onEngineTurnStart(state) {
      if (state.moveCount > 0) {
        state.elo -= 50;
        return [`😴 −50 Elo → ${state.elo}`];
      }
    },
  },

  drunkfish: {
    id: 'drunkfish',
    name: 'DrunkFish',
    emoji: '🍺',
    tagline: 'Full strength, but increasingly likely to play a random move.',
    description:
      'Plays at 3190 Elo, but each of its moves has a chance of being replaced ' +
      'by a random legal move: 0% at the start, +2% per move, capped at 80%.',
    baseElo: ELO_MAX,
    demo: [['♗d3', 'best', ''], ['♔e2', 'best', ''], ['♞a3', '??', '🎲']],
    art: { transform: 'rotate(-24deg)', anim: 'wobble', acc: [['🍺',4,52,1.6,-10],['🫧',30,14,1.2,0]] },
    extraRandomChance(state) {
      // +2% per engine move played, capped at 80%.
      return Math.min(0.8, state.moveCount * 0.02);
    },
    onEngineTurnStart(state) {
      const pct = Math.round(Math.min(0.8, state.moveCount * 0.02) * 100);
      if (state.moveCount > 0 && state.moveCount % 5 === 0) {
        return [`🍺 Random-move chance is now ${pct}%`];
      }
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
    art: { filter: 'saturate(2.4) hue-rotate(-40deg) contrast(1.15)', anim: 'shake', acc: [['💢',32,8,1.5,0],['💨',3,36,1.3,0]] },
    onPlayerMove(state, move) {
      if (move.captured) {
        state.elo = Math.min(ELO_MAX, state.elo + 200);
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
    tagline: 'Its Elo secretly re-rolls every single move.',
    description: 'Its Elo is re-rolled uniformly between 1320 and 3190 before each of its moves.',
    baseElo: Math.round((ELO_MIN + ELO_MAX) / 2),
    demo: [['♗d3', '1447', '🎲'], ['♔e2', '3102', '🎲'], ['♕g4', '1893', '🎲']],
    art: { anim: 'bob', acc: [['🎲',33,10,1.5,-15],['🃏',6,8,1.4,15]] },
    onEngineTurnStart(state) {
      state.elo = ELO_MIN + Math.floor(Math.random() * (ELO_MAX - ELO_MIN + 1));
      return [`🎰 Rolled ${state.elo} Elo for this move`];
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
    art: { filter: 'grayscale(0.7) brightness(0.85)', acc: [['🩸',6,50,1.3,0],['🌊',34,58,1.4,0]] },
    onEngineMovePlayed(state, move, game) {
      if (game.in_check()) {
        state.elo = Math.min(ELO_MAX, state.elo + 150);
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
    art: { acc: [['🌸',25,7,1.4,0],['☮️',6,26,1.2,0]] },
    onEngineMovePlayed(state, move) {
      if (move && move.captured) {
        state.elo -= 300;
        return [
          `🕊️ It captured your ${pieceName(move.captured)}: −300 Elo → ${state.elo}`,
        ];
      }
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
    art: { acc: [['✅', 32, 6, 1.3, 0], ['✅', 20, 16, 1.3, 0], ['✅', 8, 26, 1.3, 0]] },
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
  },

  cowardfish: {
    id: 'cowardfish',
    name: 'CowardFish',
    emoji: '🙈',
    tagline: 'Loses 100 Elo for each of your pieces on its half of the board.',
    description:
      'Plays at 3190 Elo minus 100 for each of your pieces currently on its ' +
      'half of the board. Recovers as they leave.',
    baseElo: ELO_MAX,
    demo: [['♙e5', '3090', '−100'], ['♘f5', '2990', '−100'], ['♕h5', '2890', '−100']],
    art: { anim: 'peek', acc: [['👀',34,6,1.4,0],['💦',10,24,1.1,15]] },
    onEngineTurnStart(state, game) {
      const invaders = countInvaders(game, state.playerColor);
      state.elo = this.baseElo - 100 * invaders;
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
};

function pieceName(p) {
  return (
    { p: '♟ Pawn', n: '♞ Knight', b: '♝ Bishop', r: '♜ Rook', q: '♛ Queen', k: '♚ King' }[p] || p
  );
}

// Export for node-based tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VARIANTS, randomMoveProbability, clampUciElo, countInvaders, ELO_MIN, ELO_MAX };
}
