# 🐟 FishTank

Play chess in your browser against Stockfish bots whose strength changes
mid-game depending on what happens on the board. Check PanicFish and it drops
200 Elo. Capture against TiltFish and it tilts. Feed RageFish and it wakes up.

Every bot is the real Stockfish engine running in WebAssembly — no forks, no
installs. The app just adjusts the engine's strength settings between moves.

## The fish

| Variant | | Condition |
|---|---|---|
| **PanicFish** | 😱 | Loses **200 Elo every time you check its king**. Sacrifice everything. Hunt the king. |
| **TiltFish** | 🤬 | Loses **200 Elo every time you capture a piece**. Trade everything. Watch it crumble. |
| **TiredFish** | 😴 | Loses **50 Elo every move it plays**. Survive the opening, win the endgame. |
| **DrunkFish** | 🍺 | Full strength, but a **growing chance each move of playing a completely random move**. |
| **RageFish** | 😡 | Starts at **200 Elo**, playing near-random moves. **Gains 200 Elo every time you capture a piece**. Don't take the bait. |
| **GamblerFish** | 🎰 | Its Elo **secretly re-rolls every move** — beginner to superhuman. Good luck. |
| **SharkFish** | 🦈 | Starts at 1600. **Gains 150 Elo every time it checks YOUR king.** Keep your king safe. |
| **PacifistFish** | 🕊️ | **Loses 300 Elo every time IT captures one of your pieces.** Bait it into trades. |
| **CowardFish** | 🙈 | **Loses 100 Elo for each of your pieces on its half of the board.** March forward. |
| **DrawFish** | 🤝 | Plays the move that keeps the evaluation **closest to 0.00**. It isn't trying to win — it's trying to draw. |
| **PityFish** | 😢 | Starts at 3190. **Loses 500 Elo whenever your move is the single worst legal move** in the position. |
| **ThreeCheckFish** | ✅ | Fixed 2200 Elo, but **three-check rules: first side to give three checks wins.** It doesn't know the rule. |
| **DragonFish** | 🐉 | **Amazon chess** (beta): each queen is a dragon that also moves like a knight. Rules by Fairy-Stockfish. |

## Play it

**Online:** [ldgarratt.github.io/fishtank](https://ldgarratt.github.io/fishtank/)

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

## After the game

- **Copy PGN** — puts the full game on your clipboard with headers, ready to
  paste into lichess, chess.com, or a database.
- **Analyse game** — replays the game through Stockfish at full strength
  (depth 12) and reports accuracy percentages, average centipawn loss, and
  every inaccuracy, mistake, and blunder with the move that was better,
  plus an evaluation graph. Same method lichess and chess.com use: each move
  is scored by how much winning chance it gave away.

## How the strength adjustment works

Each bot tracks an *effective Elo* that its rules update during the game, and
the app reconfigures Stockfish before every engine move:

- **1320–3190** — Stockfish's built-in limiter (`UCI_LimitStrength` +
  `UCI_Elo`) is used directly. This is the engine's supported range.
- **Below 1320** — the limiter can't go lower, so the app uses the approach
  [lichess uses for its weak AI levels](https://lichess.org/forum/general-chess-discussion/how-are-lichess-stockfish-levels-configured):
  a **normal depth-5 search** paired with a low or negative **Skill Level**.
  Rather than crippling the search (a depth-1 engine plays alien, not weak),
  the engine looks at the position properly and then *chooses* among several
  candidate moves with score noise that grows as the level drops.

  Classical Stockfish only accepts Skill Level 0–20; lichess reaches negative
  levels by running Fairy-Stockfish. FishTank keeps the stock engine and
  reimplements Stockfish's own `Skill::pick_best()` formula in JS over a
  MultiPV list, so the level can go continuously negative down to −20. The
  Elo → Skill mapping is anchored on lichess's published level calibration
  (≈400 Elo → skill −9, 500 → −5, 800 → −1, 1100 → +3).

  Only below ~250 Elo is a little pure randomness (max 12%) mixed in; those
  moves are marked 🎲 in the feed.

  The gold standard for *human-like* weak play is
  [Maia](https://www.maiachess.com/), a neural net trained on millions of
  human games at specific rating bands — it reproduces human mistakes rather
  than approximating them. That needs Leela-style weights per rating, which is
  heavy for a browser page, so it's out of scope here.

Effective Elo is clamped to **100–3190**, so a bot that keeps draining (a
long game against TiredFish, say) bottoms out at 100 rather than going
negative.

Note on accuracy: the browser build is a single-threaded WASM engine, so
nominal ratings run a bit below their native-hardware calibration. Treat the
displayed Elo as a good approximation, not a lab measurement.

## DragonFish and fairy variants (beta)

DragonFish plays [amazon chess](https://www.chessvariants.com/diffmove.dir/amazone.html)
— both queens are "dragons" that combine queen and knight movement. Legal
moves, checks, and mates come from [ffish.js](https://www.npmjs.com/package/ffish),
the official Fairy-Stockfish binding, running in a web worker.

Its opponent brain is the full
[Fairy-Stockfish NNUE WASM engine](https://www.npmjs.com/package/fairy-stockfish-nnue.wasm)
where the browser allows it. That build needs SharedArrayBuffer, which
requires cross-origin isolation; on GitHub Pages this is enabled by
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (vendored
at deploy time — it may trigger one automatic page reload on first visit).
If isolation isn't available, DragonFish silently falls back to a built-in
lite alpha-beta search; the feed tells you which brain is active.

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
`onEngineTurnStart(state, game)` (before the engine thinks),
`onEngineMovePlayed(state, move, game)` (after the engine's move),
`extraRandomChance(state, game)` (probability of a totally random move), and
`checkCustomEnd(state, game)` (custom win conditions, e.g. three-check), and
`onPlayerMoveAsync(state, ctx)` for hooks that need the engine — `ctx` gives
you `{ move, game, engine, fenBefore, legalCount }`, so a variant can rank
every legal move (this is how PityFish spots your worst one).

A variant can also take over move selection entirely with
`pickMove(state, ctx)`, returning `{ uci, events }` — DrawFish uses this with
`engine.rankMoves()` to choose the most equal move instead of the best one —
and replace the rating readout via `eloLabel(state)`.
`state.playerColor` tells you which side the human plays.
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
