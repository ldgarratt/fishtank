#!/usr/bin/env bash
# Downloads the single-threaded Stockfish 16.1 "lite" WASM build (from the
# official stockfish npm package, GPLv3) into this directory so the site can
# run fully self-contained. The web app falls back to a CDN copy if these
# files are missing.
set -euo pipefail
cd "$(dirname "$0")"

# Pinned to the v16.1.0 tag of the official stockfish.js repo (the npm CDN
# does not ship these files, so we pull straight from the source repo).
BASE="https://raw.githubusercontent.com/nmrugg/stockfish.js/v16.1.0/src"

curl -fsSL -o stockfish-16.1-lite-single.js "$BASE/stockfish-16.1-lite-single.js"
curl -fsSL -o stockfish-16.1-lite-single.wasm "$BASE/stockfish-16.1-lite-single.wasm"

# Sanity checks: glue should be JS text, wasm should start with '\0asm'.
grep -q "Stockfish" stockfish-16.1-lite-single.js
[ "$(head -c 4 stockfish-16.1-lite-single.wasm)" = "$(printf '\0asm')" ]

# Also vendor chess.js so local play works fully offline.
# NOTE: must be the classic-script (global `Chess`) build — the file at the
# GitHub v0.13.x tags is an ES module and breaks as a plain <script>.
mkdir -p ../vendor
curl -fsSL -o ../vendor/chess.js \
  https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.js
grep -q "in_checkmate" ../vendor/chess.js
if grep -qE '^\s*export ' ../vendor/chess.js; then
  echo "ERROR: chess.js is an ES module build; need classic script" >&2
  exit 1
fi

# Official Stockfish logo (icon by Klein Maetschke) for the UI.
mkdir -p ../img
curl -fsSL -o ../img/stockfish.png \
  "https://stockfishchess.org/images/logo/icon_128x128@2x.png"
[ "$(wc -c < ../img/stockfish.png)" -gt 1000 ]

# cburnett SVG chess pieces (Colin M.L. Burnett, CC BY-SA 3.0) via lichess.
mkdir -p ../img/pieces
for p in wK wQ wR wB wN wP bK bQ bR bB bN bP; do
  curl -fsSL -o "../img/pieces/$p.svg" \
    "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/$p.svg"
  grep -q "<svg" "../img/pieces/$p.svg"
done
# Board sounds from lichess's standard set (optional — the app falls back to
# lichess's GitHub copy, then to silence, so missing files never break it).
mkdir -p ../sound
for f in Move.mp3 Capture.mp3 GenericNotify.mp3 Victory.mp3 Defeat.mp3 Draw.mp3; do
  curl -fsSL -o "../sound/$f" \
    "https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/$f" \
    || { echo "warn: optional sound $f not found"; rm -f "../sound/$f"; }
done

# ffish.js — Fairy-Stockfish rules engine for the DragonFish (amazon) variant.
# Optional: the app falls back to jsDelivr at runtime if these are missing.
mkdir -p fairy
if curl -fsSL -o fairy/ffish.js "https://cdn.jsdelivr.net/npm/ffish@0.7.5/ffish.js" &&
   curl -fsSL -o fairy/ffish.wasm "https://cdn.jsdelivr.net/npm/ffish@0.7.5/ffish.wasm"; then
  echo "ffish (DragonFish rules) downloaded"
else
  echo "warn: optional ffish not downloaded; DragonFish will use the CDN"
  rm -f fairy/ffish.js fairy/ffish.wasm
fi

echo "Done. Files downloaded:"
ls -lh stockfish-16.1-lite-single.* ../vendor/chess.js
