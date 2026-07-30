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
mkdir -p ../vendor
curl -fsSL -o ../vendor/chess.js \
  https://raw.githubusercontent.com/jhlywa/chess.js/v0.13.4/chess.js
grep -q "in_checkmate" ../vendor/chess.js

echo "Done. Files downloaded:"
ls -lh stockfish-16.1-lite-single.* ../vendor/chess.js
