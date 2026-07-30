#!/usr/bin/env bash
# Downloads the single-threaded Stockfish 16.1 "lite" WASM build (from the
# official stockfish npm package, GPLv3) into this directory so the site can
# run fully self-contained. The web app falls back to a CDN copy if these
# files are missing.
set -euo pipefail
cd "$(dirname "$0")"

BASE="https://cdn.jsdelivr.net/npm/stockfish@16.1.0/src"

curl -fsSL -o stockfish-16.1-lite-single.js "$BASE/stockfish-16.1-lite-single.js"
curl -fsSL -o stockfish-16.1-lite-single.wasm "$BASE/stockfish-16.1-lite-single.wasm"

# Also vendor chess.js so local play works fully offline.
mkdir -p ../vendor
curl -fsSL -o ../vendor/chess.js \
  https://cdn.jsdelivr.net/npm/chess.js@0.13.4/chess.js

echo "Done. Files downloaded:"
ls -lh stockfish-16.1-lite-single.* ../vendor/chess.js
