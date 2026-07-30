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

echo "Done. Files downloaded:"
ls -lh stockfish-16.1-lite-single.* ../vendor/chess.js
