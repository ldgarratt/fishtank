# 🐟 FishTank

**Real Stockfish, but emotionally unstable.**

A browser chess GUI where you play against genuine Stockfish — except each
variant has a psychological condition that changes its strength as the game
unfolds. No engine forks, no installs: the app drives real Stockfish (WASM)
and abuses its built-in strength limiter (`UCI_LimitStrength` / `UCI_Elo`)
live, mid-game.

## The fish

| Variant | | Condition |
|---|---|---|
| **PanicFish** | 😱 | Loses **200 Elo every time you check its king**. Sacrifice everything. Hunt the king. |
| **TiltFish** | 🤬 | Loses **200 Elo every time you capture a piece**. Trade everything. Watch it crumble. |
| **TiredFish** | 😴 | Loses **50 Elo every move it plays**. Survive the opening, win the endgame. |
| **DrunkFish** | 🍺 | Full strength, but a **growing chance each move of playing a completely random move**. |
| **RageFish** | 😡 | Starts weak. **Gains 200 Elo every time you capture a piece**. Don't take the bait. |
| **GamblerFish** | 🎰 | Its Elo **secretly re-rolls every move** — beginner to superhuman. Good luck. |

## Play it

**Online:** enable GitHub Pages (see below) and play at
`https://<your-username>.github.io/fishtank/`.

**Locally:** serve the folder with any static server (workers can't load from
`file://`):

```bash
cd fishtank
python3 -m http.server 8000
# open http://localhost:8000
```

Optional but recommended for local play — download the engine once so it
doesn't stream from a CDN:

```bash
bash engine/get-engine.sh
```

## How the Elo trickery works

Stockfish exposes `UCI_LimitStrength` + `UCI_Elo` (range **1320–3190**). Each
variant tracks an *effective Elo* and the app re-sends `UCI_Elo` before every
engine move. When a variant drops **below 1320** (the engine's floor), the app
keeps Stockfish at 1320 but adds an increasing probability of substituting a
completely random legal move — so a fully panicked PanicFish really does play
like it's having a breakdown. Random moves are marked 🎲 in the move feed.

Weaker states also get shorter think times, which keeps games snappy.

## Publishing / deployment

The repo ships with a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that, on every push to `main`:

1. downloads the official Stockfish 16.1 lite WASM build and chess.js, and
2. deploys everything to GitHub Pages —

so the published site is fully self-contained. To enable it:
**Settings → Pages → Source: GitHub Actions**. If the vendored engine is
missing (e.g. running from a plain checkout), the app automatically falls back
to loading the engine from jsDelivr, and Stockfish 10 (asm.js) as a last
resort.

## Add your own fish

Every bot is one entry in `js/variants.js` — no other file changes needed.
The card, Elo meter, and event feed pick it up automatically. Example, a fish
that gets stronger every time it gives *you* check:

```js
bloodfish: {
  id: 'bloodfish',
  name: 'BloodFish',
  emoji: '🩸',
  tagline: 'Gains 150 Elo every time it checks YOUR king.',
  description: 'It can smell weakness. Keep your king safe.',
  baseElo: 1600,
  onEngineTurnStart(state, game) {
    if (game.in_check()) {
      state.elo = Math.min(ELO_MAX, state.elo + 150);
      return [`🩸 BloodFish tastes blood — +150 Elo → ${state.elo}`];
    }
  },
},
```

Hooks you can use: `onPlayerMove(state, move, game)` (after the human moves),
`onEngineTurnStart(state, game)` (before the engine thinks), and
`extraRandomChance(state, game)` (probability of a totally random move).
`state.elo` is the effective Elo; below 1320 the app automatically converts
the deficit into random-move probability.

## Tech

- [Stockfish](https://stockfishchess.org/) 16.1 "lite" single-threaded WASM
  build from the official [stockfish npm package](https://www.npmjs.com/package/stockfish) (GPLv3)
- [chess.js](https://github.com/jhlywa/chess.js) 0.10.3 (classic-script build)
  for rules, legality, check/mate detection (BSD-2)
- Vanilla JS/CSS GUI — no framework, no build step

Run the variant-logic unit tests with:

```bash
node test/test-variants.js
```

## License

GPL-3.0 — required because the site distributes Stockfish. See `LICENSE`.
