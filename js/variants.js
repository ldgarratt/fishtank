/*
 * FishTank — emotionally unstable Stockfish variants.
 * Each variant defines how the engine's effective Elo changes during the game.
 *
 * Elo model:
 *   - Real Stockfish supports UCI_LimitStrength + UCI_Elo in [1320, 3190].
 *   - We track an unbounded "effective elo". Within range it maps straight to
 *     UCI_Elo. Below 1320 the engine stays at 1320 but gains an increasing
 *     probability of playing a completely random legal move instead.
 */

const ELO_MIN = 1320;
const ELO_MAX = 3190;

/** Probability of a totally random move when effective elo is below the engine floor. */
function randomMoveProbability(effectiveElo) {
  if (effectiveElo >= ELO_MIN) return 0;
  return Math.min(0.9, (ELO_MIN - effectiveElo) / 900);
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
    description:
      'Starts at full strength. Every check you deliver sends it into a spiral. ' +
      'Sacrifice everything. Hunt the king.',
    baseElo: ELO_MAX,
    demo: [['♗b5+', '2990', '−200'], ['♕h5+', '2790', '−200'], ['♖e8+', '2590', '−200']],
    onPlayerMove(state, move, game) {
      if (game.in_check()) {
        state.elo -= 200;
        return [`♚ Check! PanicFish is panicking — −200 Elo → ${state.elo}`];
      }
    },
  },

  tiltfish: {
    id: 'tiltfish',
    name: 'TiltFish',
    emoji: '🤬',
    tagline: 'Loses 200 Elo every time you capture one of its pieces.',
    description:
      'Starts at full strength, but every piece you take sends it deeper on tilt. ' +
      'Trade everything. Watch it crumble.',
    baseElo: ELO_MAX,
    demo: [['♞xd4', '2990', '−200'], ['♝xf3', '2790', '−200'], ['♜xa2', '2590', '−200']],
    onPlayerMove(state, move) {
      if (move.captured) {
        state.elo -= 200;
        return [
          `${pieceName(move.captured)} captured! TiltFish is tilting — −200 Elo → ${state.elo}`,
        ];
      }
    },
  },

  tiredfish: {
    id: 'tiredfish',
    name: 'TiredFish',
    emoji: '😴',
    tagline: 'Loses 50 Elo every move it plays. Play the long game.',
    description:
      'Starts at full strength but gets sleepier every move. Survive the opening ' +
      'and grind it into a blunder-filled endgame.',
    baseElo: ELO_MAX,
    demo: [['♗d3', '3140', '−50'], ['♔e2', '3090', '−50'], ['♕g4', '3040', '−50']],
    onEngineTurnStart(state) {
      if (state.moveCount > 0) {
        state.elo -= 50;
        return [`😴 TiredFish yawns... −50 Elo → ${state.elo}`];
      }
    },
  },

  drunkfish: {
    id: 'drunkfish',
    name: 'DrunkFish',
    emoji: '🍺',
    tagline: 'Full strength, but increasingly likely to play a random move.',
    description:
      'Thinks at full strength, but each move has a growing chance of being ' +
      'completely random. It keeps drinking as the game goes on.',
    baseElo: ELO_MAX,
    demo: [['♗d3', 'best', ''], ['♔e2', 'best', ''], ['♞a3', '??', '🎲']],
    extraRandomChance(state) {
      // +2% per engine move played, capped at 80%.
      return Math.min(0.8, state.moveCount * 0.02);
    },
    onEngineTurnStart(state) {
      const pct = Math.round(Math.min(0.8, state.moveCount * 0.02) * 100);
      if (state.moveCount > 0 && state.moveCount % 5 === 0) {
        return [`🍺 DrunkFish orders another round — ${pct}% chance of a random move`];
      }
    },
  },

  ragefish: {
    id: 'ragefish',
    name: 'RageFish',
    emoji: '😡',
    tagline: 'Starts at 200 Elo. Gains 200 every time you capture one of its pieces.',
    description:
      'Starts basically asleep at 200 Elo, flopping pieces around at random. ' +
      'Every piece you take makes it angrier — and much stronger. How long can ' +
      'you resist taking the bait?',
    baseElo: 200,
    demo: [['♟xe5', '400', '+200'], ['♞xc3', '600', '+200'], ['♝xb2', '800', '+200']],
    onPlayerMove(state, move) {
      if (move.captured) {
        state.elo = Math.min(ELO_MAX, state.elo + 200);
        return [
          `${pieceName(move.captured)} captured! RageFish is FURIOUS — +200 Elo → ${state.elo}`,
        ];
      }
    },
  },

  gamblerfish: {
    id: 'gamblerfish',
    name: 'GamblerFish',
    emoji: '🎰',
    tagline: 'Its Elo secretly re-rolls every single move.',
    description:
      'Every move, it rolls the dice: anywhere from beginner to superhuman. ' +
      'You never know who is across the board.',
    baseElo: Math.round((ELO_MIN + ELO_MAX) / 2),
    demo: [['♗d3', '1447', '🎲'], ['♔e2', '3102', '🎲'], ['♕g4', '1893', '🎲']],
    onEngineTurnStart(state) {
      state.elo = ELO_MIN + Math.floor(Math.random() * (ELO_MAX - ELO_MIN + 1));
      return [`🎰 GamblerFish rolls the dice... it plays this move at ${state.elo} Elo`];
    },
  },

  sharkfish: {
    id: 'sharkfish',
    name: 'SharkFish',
    emoji: '🦈',
    tagline: 'Gains 150 Elo every time it checks YOUR king.',
    description:
      'Starts mid-strength, but it can smell weakness: every check it delivers ' +
      'makes it stronger. Keep your king safe or get eaten.',
    baseElo: 1600,
    demo: [['♗b5+', '1750', '+150'], ['♕h5+', '1900', '+150'], ['♖e8+', '2050', '+150']],
    onEngineMovePlayed(state, move, game) {
      if (game.in_check()) {
        state.elo = Math.min(ELO_MAX, state.elo + 150);
        return [`🦈 Check! SharkFish smells blood — +150 Elo → ${state.elo}`];
      }
    },
  },

  pacifistfish: {
    id: 'pacifistfish',
    name: 'PacifistFish',
    emoji: '🕊️',
    tagline: 'Loses 300 Elo every time IT captures one of your pieces.',
    description:
      'Full strength, but it hates itself for violence. Every piece it takes ' +
      'from you costs it dearly. Bait it into trades — sacrifice for victory.',
    baseElo: ELO_MAX,
    demo: [['♗xf6', '2890', '−300'], ['♘xd5', '2590', '−300'], ['♕xh7', '2290', '−300']],
    onEngineMovePlayed(state, move) {
      if (move && move.captured) {
        state.elo -= 300;
        return [
          `🕊️ It captured your ${pieceName(move.captured)} and hates itself — −300 Elo → ${state.elo}`,
        ];
      }
    },
  },

  cowardfish: {
    id: 'cowardfish',
    name: 'CowardFish',
    emoji: '🙈',
    tagline: 'Loses 100 Elo for each of your pieces on its half of the board.',
    description:
      'Full strength while you stay home. Every piece you park on its side of ' +
      'the board terrifies it. March forward and watch it faint.',
    baseElo: ELO_MAX,
    demo: [['♙e5', '3090', '−100'], ['♘f5', '2990', '−100'], ['♕h5', '2890', '−100']],
    onEngineTurnStart(state, game) {
      const invaders = countInvaders(game, state.playerColor);
      state.elo = this.baseElo - 100 * invaders;
      if (invaders !== (state.lastInvaders || 0)) {
        state.lastInvaders = invaders;
        if (invaders > 0) {
          return [
            `🙈 ${invaders} invader${invaders === 1 ? '' : 's'} on its half — CowardFish trembles! Elo → ${state.elo}`,
          ];
        }
        return [`🙈 Its half is clear again. CowardFish recovers → ${state.elo}`];
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
