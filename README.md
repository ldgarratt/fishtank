# 🐟 FishTank

Play chess in your browser against Stockfish bots whose strength changes
mid-game depending on what happens on the board. Check PanicFish and it drops
300 Elo. Capture against TiltFish and it tilts. Feed RageFish and it wakes up.

Every bot is the real Stockfish engine running in WebAssembly — no forks, no
installs. The app just adjusts the engine's strength settings between moves.

## The fish

| Variant | Condition |
|---|---|
| **PanicFish** | Loses **300 Elo every time you check its king**. Sacrifice everything. Hunt the king. |
| **TiltFish** | Loses **200 Elo every time you capture a piece**. Trade everything. Watch it crumble. |
| **TiredFish** | Loses **50 Elo every move it plays**. Survive the opening, win the endgame. |
| **ClockFish** | Its rating is **your clock**: instant replies face a beginner, five seconds faces the full 3190. |
| **DrunkFish** | Full strength, but a flat **5% chance each move of blundering** — throwing away at least two pawns. |
| **RageFish** | Starts at **200 Elo**, playing near-random moves. **Gains 200 Elo every time you capture a piece**. Don't take the bait. |
| **GamblerFish** | **Re-rolls its Elo every 3 moves** — beginner to superhuman — and holds it in between. |
| **SharkFish** | Starts at 1600. **Gains 150 Elo every time it checks YOUR king.** Keep your king safe. |
| **PacifistFish** | **Loses 300 Elo every time IT captures one of your pieces.** Bait it into trades. |
| **DrawFish** | Plays the move that keeps the evaluation **closest to 0.00**. It isn't trying to win — it's trying to draw. |
| **WorstFish** | Plays the **worst legal move** in every position. Hangs everything, walks into mate. |
| **PityFish** | Starts at 3190. **Loses 500 Elo whenever your move is the single worst legal move** in the position. |
| **CowardFish** | **Loses 400 Elo for each of your pieces on its half of the board.** March forward. |
| **QueenlessFish** | Full strength, but **starts without its queen**. The classical handicap. |
| **RooklessFish** | Full strength, but **starts without a rook** (and the castling right on that side). |
| **KnightlessFish** | Full strength, but **starts without a knight**. The gentlest odds. |
| **BishoplessFish** | Full strength, but **starts without a bishop**, leaving it half the board. |
| **ThreeCheckFish** | Fixed 2200 Elo, but **three-check rules: first side to give three checks wins.** It doesn't know the rule. |
| **DragonFish** | **Amazon chess** (beta): the queen is replaced by a dragon, which moves like a queen *and* a knight. Pawns promote to a dragon, rook, bishop or knight. Rules by Fairy-Stockfish. |
| **ArmyFish** | **Your knights are chancellors and your bishops are archbishops**; the engine gets a normal army. |
| **DragonlessFish** | It plays **without a dragon**; your queen moves like a queen *and* a knight, its queen does not. |

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

## Reviewing a game

Arrow keys step through the moves, as on lichess: **←** back a move, **→**
forward, **↑** jump to the start, **↓** back to the live position. The board
dims while you're looking at an earlier position, and clicking it (or making
a move) returns to the present.

## After the game

- **Copy PGN** — puts the full game on your clipboard with headers, ready to
  paste into lichess, chess.com, or a database.
- **Analyse game** — replays the game through Stockfish at full strength
  and reports accuracy percentages, average centipawn loss, and
  every inaccuracy, mistake, and blunder with the move that was better,
  plus an evaluation graph. Same method lichess and chess.com use: each move
  is scored by how much winning chance it gave away, and the game accuracy
  combines a volatility-weighted mean with a harmonic mean so that a few
  disasters aren't averaged away by a pile of obvious recaptures.

  Click any listed mistake to jump to it. A green arrow on the board shows the
  move Stockfish would have played instead, and the arrow keys walk forwards
  and backwards from there.

## How the strength adjustment works

Each bot tracks an *effective Elo* that its rules update during the game. The
engine always searches at **full strength**; the rating decides how much
evaluation the bot is willing to throw away when it picks a move.

Before each engine move, FishTank runs a MultiPV search, then chooses among the
candidates whose evaluation is within an allowance for that rating:

| Rating | Allowance | In practice |
|---|---|---|
| 3190 | 0 cp | always the best move |
| 2800 | 20 cp | barely distinguishable from perfect |
| 2400 | 45 cp | small inaccuracies |
| 2000 | 80 cp | imperfect, but **cannot hang a piece** |
| 1600 | 130 cp | real positional errors |
| 1200 | 200 cp | drops a pawn now and then |
| 400 | 450 cp | drops pieces, like a beginner |

Moves that lose less are chosen more often, so play degrades smoothly rather
than alternating between perfect and terrible.

### Why not Stockfish's own `UCI_Elo`?

Because it doesn't mean what it appears to. Stockfish converts the rating to an
internal Skill Level — **`UCI_Elo 2000` becomes Skill Level 4 of 20** — and
weakens play by *occasionally choosing a much worse move* from a short
candidate list. The result is strong positional play punctuated by hanging a
piece, which is not how a 2000-rated human plays. Its scale is also calibrated
against engine opponents rather than human rating pools.

The bounded-loss model above gives a guarantee instead: a bot at rating R never
plays a move worse than R's allowance, so the number on the card constrains
what you will actually see on the board.

Two caveats remain. The browser build is single-threaded WASM, so its
evaluations come from a shallower search than a native engine would produce —
think time scales with rating (600 ms below 1600, up to 2 s at the top) to
limit that. And the mapping from "centipawn allowance" to "human Elo" is
judgement, not measurement: it is calibrated to behaviour (what kind of mistake
a rating should make) rather than to tournament results.

Below ~250 Elo a little pure randomness (max 12%) is mixed in for bots like
RageFish that start near the floor; those moves are marked 🎲 in the feed.
Effective Elo is clamped to **100–3190**.

### Maia: human-like play where it's trained

Bots whose current rating falls between **1100 and 1900** play through
[Maia](https://www.maiachess.com/) instead — a neural network trained on
millions of human games that predicts *the move a player of that rating would
actually play*. FishTank samples from that distribution, so the mistakes are
human mistakes rather than an engine occasionally throwing a piece.

Maia 3 is a single model that takes both players' ratings as inputs, so one
network covers the whole band and a bot's rating can drift mid-game without
swapping models. It is ~44 MB, downloaded on first use and cached in
IndexedDB; until it arrives (or if it fails) those bots fall back to the model
below. Outside 1100–1900 — full-strength bots, and beginners under 1100 —
Maia has no training data, so the bounded-loss model is used there.

The encoding, move table and inference setup are ported from the Maia
platform's own implementation
([CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend),
GPL-3.0) so the tensors match what the model was trained on.

### The fallback: bounded loss

This model bounds the *size* of a mistake but not its *kind*. A real 1200 misses
tactics in sharp positions and plays fine in quiet ones; this one spreads its
allowance evenly.

Maia (above) covers 1100–1900. Outside that band this model is what runs, and
it is also what DrawFish, WorstFish, PityFish and the post-game analysis use,
since those need evaluations and Maia returns only a move distribution.

## Handicap variants

Several bots hand *you* the advantage instead of weakening the engine:

- **QueenlessFish**, **RooklessFish**, **KnightlessFish** and
  **BishoplessFish** are ordinary chess from a lopsided position — the engine
  simply starts a piece down. No fairy engine involved; it is a custom start
  FEN fed to chess.js and Stockfish, and the PGN carries `SetUp`/`FEN` so the
  game replays correctly elsewhere. Losing a corner rook also gives up that
  side's castling right, which the FEN has to say explicitly.
- **DragonlessFish** and **ArmyFish** need pieces that standard chess does not
  have, so they are defined at runtime with `ffish.loadVariantConfig`:

  ```ini
  [army:chess]
  archbishop = a
  chancellor = c
  startFen = rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RCAQKACR w KQkq - 0 1
  ```

  Inheriting from `chess` means only the differences need stating. The starting
  FEN is generated per game, because the upgraded pieces must always land on
  whichever colour *you* chose.

The prebuilt Fairy-Stockfish NNUE binary only knows the variants compiled into
it, so these two always use the built-in search described below. Since you are
several points of material up, that is not much of a loss.

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
alpha-beta search; the feed tells you which brain is active. That fallback is
iterative-deepening alpha-beta with a quiescence search, MVV-LVA move
ordering, killer moves and piece-square tables — the quiescence part being
what stops it grabbing a defended piece and only noticing the recapture a
move later.

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
