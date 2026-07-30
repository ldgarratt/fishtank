/* FishTank — main app: board UI, game loop, variant wiring. */
/* global Chess, VARIANTS, randomMoveProbability, clampUciElo, ELO_MIN, ELO_MAX, SillyEngine */

(() => {
  const UNICODE = {
    wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
    bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
  };

  const els = {
    picker: document.getElementById('picker'),
    cards: document.getElementById('variant-cards'),
    game: document.getElementById('game'),
    board: document.getElementById('board'),
    log: document.getElementById('log'),
    eloValue: document.getElementById('elo-value'),
    eloBar: document.getElementById('elo-bar'),
    mood: document.getElementById('mood'),
    oppName: document.getElementById('opp-name'),
    oppTagline: document.getElementById('opp-tagline'),
    status: document.getElementById('status'),
    engineStatus: document.getElementById('engine-status'),
    btnNew: document.getElementById('btn-new'),
    btnSwitch: document.getElementById('btn-switch'),
    btnUndo: document.getElementById('btn-undo'),
    sideSelect: document.getElementById('side-select'),
  };

  let engine = null;
  let engineReady = false;
  let game = null; // chess.js instance
  let variant = null;
  let vstate = null; // { elo, moveCount, ... }
  let playerColor = 'w';
  let selectedSquare = null;
  let thinking = false;
  let gameOver = false;

  /* ---------- variant picker ---------- */

  function buildPicker() {
    els.cards.innerHTML = '';
    for (const v of Object.values(VARIANTS)) {
      const card = document.createElement('button');
      card.className = 'card';
      card.innerHTML =
        `<div class="card-icon"><img src="img/stockfish.png" alt="" ` +
        `onerror="this.parentElement.classList.add('no-logo');this.remove()">` +
        `<span class="card-emoji">${v.emoji}</span></div>` +
        `<div class="card-name">${v.name}</div>` +
        `<div class="card-tag">${v.tagline}</div>`;
      card.addEventListener('click', () => startGame(v.id));
      els.cards.appendChild(card);
    }
  }

  /* ---------- game setup ---------- */

  function startGame(variantId) {
    variant = VARIANTS[variantId];
    vstate = { elo: variant.baseElo, moveCount: 0 };
    if (variant.init) variant.init(vstate);
    game = new Chess();
    selectedSquare = null;
    thinking = false;
    gameOver = false;
    playerColor = els.sideSelect.value === 'b' ? 'b' : 'w';

    els.picker.classList.add('hidden');
    els.game.classList.remove('hidden');
    els.oppName.textContent = `${variant.emoji} ${variant.name}`;
    els.oppTagline.textContent = variant.tagline;
    els.log.innerHTML = '';
    logEvent(`New game vs ${variant.name}. ${variant.description}`);
    logEvent(`Starting Elo: ${vstate.elo}`);
    updateEloUI();
    renderBoard();

    if (engine && engineReady) engine.newGame();

    if (playerColor === 'b') {
      setTimeout(engineMove, 400);
    } else {
      setStatus('Your move.');
    }
  }

  function backToPicker() {
    els.game.classList.add('hidden');
    els.picker.classList.remove('hidden');
  }

  /* ---------- board rendering ---------- */

  function squareName(fileIdx, rankIdx) {
    return 'abcdefgh'[fileIdx] + (8 - rankIdx);
  }

  function renderBoard() {
    els.board.innerHTML = '';
    const flipped = playerColor === 'b';
    const legalTargets = new Set();
    if (selectedSquare) {
      for (const m of game.moves({ square: selectedSquare, verbose: true })) {
        legalTargets.add(m.to);
      }
    }
    const lastMove = game.history({ verbose: true }).slice(-1)[0] || null;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rr = flipped ? 7 - r : r;
        const ff = flipped ? 7 - f : f;
        const sq = squareName(ff, rr);
        const cell = document.createElement('div');
        cell.className = 'sq ' + (((rr + ff) % 2 === 0) ? 'light' : 'dark');
        cell.dataset.sq = sq;
        const piece = game.get(sq);
        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece ' + (piece.color === 'w' ? 'white-piece' : 'black-piece');
          span.textContent = UNICODE[piece.color + piece.type];
          cell.appendChild(span);
        }
        if (selectedSquare === sq) cell.classList.add('selected');
        if (legalTargets.has(sq)) cell.classList.add(piece ? 'capture-target' : 'move-target');
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cell.classList.add('last-move');
        if (piece && piece.type === 'k' && game.in_check() && piece.color === game.turn()) {
          cell.classList.add('in-check');
        }
        cell.addEventListener('click', () => onSquareClick(sq));
        els.board.appendChild(cell);
      }
    }
  }

  /* ---------- interaction ---------- */

  function onSquareClick(sq) {
    if (thinking || gameOver || !game) return;
    if (game.turn() !== playerColor) return;

    const piece = game.get(sq);
    if (selectedSquare) {
      if (sq === selectedSquare) {
        selectedSquare = null;
        renderBoard();
        return;
      }
      const move = game.move({ from: selectedSquare, to: sq, promotion: 'q' });
      if (move) {
        selectedSquare = null;
        afterPlayerMove(move);
        return;
      }
    }
    if (piece && piece.color === playerColor) {
      selectedSquare = sq;
    } else {
      selectedSquare = null;
    }
    renderBoard();
  }

  /* ---------- game loop ---------- */

  function afterPlayerMove(move) {
    renderBoard();
    logMove('You', move.san);
    const events = (variant.onPlayerMove && variant.onPlayerMove(vstate, move, game)) || [];
    for (const ev of events) logEvent(ev);
    updateEloUI();
    if (checkGameEnd()) return;
    engineMove();
  }

  async function engineMove() {
    if (gameOver) return;
    thinking = true;
    setStatus(`${variant.name} is thinking…`);

    const events = (variant.onEngineTurnStart && variant.onEngineTurnStart(vstate, game)) || [];
    for (const ev of events) logEvent(ev);
    updateEloUI();

    // Decide whether this move is random (drunk / below-floor sputtering).
    const pBelowFloor = randomMoveProbability(vstate.elo);
    const pExtra = (variant.extraRandomChance && variant.extraRandomChance(vstate, game)) || 0;
    const pRandom = Math.min(0.95, pBelowFloor + pExtra);
    let san = null;

    if (Math.random() < pRandom) {
      const moves = game.moves({ verbose: true });
      const m = moves[Math.floor(Math.random() * moves.length)];
      await sleep(350 + Math.random() * 500);
      const played = game.move(m.san);
      san = played.san;
      logMove(variant.name, san + '  🎲');
    } else {
      const uciElo = clampUciElo(vstate.elo);
      engine.setStrength(uciElo);
      const uci = await engine.bestMove(game.fen(), moveTimeFor(uciElo));
      if (!uci || uci === '(none)') {
        thinking = false;
        checkGameEnd();
        return;
      }
      const played = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!played) {
        // Extremely defensive: engine gave an illegal move (shouldn't happen).
        const moves = game.moves({ verbose: true });
        const m = moves[Math.floor(Math.random() * moves.length)];
        game.move(m.san);
        san = m.san;
      } else {
        san = played.san;
      }
      logMove(variant.name, san);
    }

    vstate.moveCount += 1;
    thinking = false;
    renderBoard();
    updateEloUI();
    if (checkGameEnd()) return;
    setStatus('Your move.');
  }

  function moveTimeFor(uciElo) {
    // Weaker settings don't need long thinks; keeps the game snappy.
    return uciElo >= 2600 ? 900 : uciElo >= 2000 ? 600 : 400;
  }

  function checkGameEnd() {
    if (!game.game_over()) return false;
    gameOver = true;
    let msg;
    if (game.in_checkmate()) {
      const winnerIsPlayer = game.turn() !== playerColor;
      msg = winnerIsPlayer
        ? `🏆 Checkmate — you beat ${variant.name}!`
        : `💀 Checkmate — ${variant.name} wins.`;
    } else if (game.in_stalemate()) msg = '🤝 Stalemate.';
    else if (game.in_threefold_repetition()) msg = '🤝 Draw by repetition.';
    else if (game.insufficient_material()) msg = '🤝 Draw — insufficient material.';
    else msg = '🤝 Draw (50-move rule).';
    setStatus(msg);
    logEvent(msg);
    return true;
  }

  /* ---------- undo ---------- */

  function undo() {
    if (thinking || !game) return;
    // Undo engine reply + player move so it's the player's turn again.
    if (game.history().length === 0) return;
    game.undo();
    if (game.turn() !== playerColor && game.history().length > 0) game.undo();
    gameOver = false;
    selectedSquare = null;
    logEvent('↩️ Move taken back (Elo effects are NOT refunded — actions have consequences).');
    renderBoard();
    setStatus('Your move.');
  }

  /* ---------- UI helpers ---------- */

  function updateEloUI() {
    els.eloValue.textContent = Math.round(vstate.elo);
    const span = ELO_MAX - 800; // display floor at 800 so the bar can visibly empty
    const pct = Math.max(0, Math.min(1, (vstate.elo - 800) / span));
    els.eloBar.style.width = (pct * 100).toFixed(1) + '%';
    els.eloBar.className = 'elo-bar ' + (pct > 0.66 ? 'elo-high' : pct > 0.33 ? 'elo-mid' : 'elo-low');
    els.mood.textContent = moodFor();
  }

  function moodFor() {
    const e = vstate.elo;
    if (variant.id === 'gamblerfish') return '🎰';
    if (e >= 3000) return variant.emoji === '😡' ? '🌋' : '🤖';
    if (e >= 2400) return '😼';
    if (e >= 1800) return '😐';
    if (e >= 1320) return '😵‍💫';
    return '🫠';
  }

  function logMove(who, san) {
    const n = Math.ceil(game.history().length / 2);
    const div = document.createElement('div');
    div.className = 'log-move';
    div.textContent = `${n}. ${who}: ${san}`;
    els.log.prepend(div);
  }

  function logEvent(text) {
    const div = document.createElement('div');
    div.className = 'log-event';
    div.textContent = text;
    els.log.prepend(div);
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /* ---------- boot ---------- */

  async function boot() {
    buildPicker();
    els.btnNew.addEventListener('click', backToPicker);
    els.btnSwitch.addEventListener('click', backToPicker);
    els.btnUndo.addEventListener('click', undo);

    engine = new SillyEngine();
    try {
      const name = await engine.init((s) => (els.engineStatus.textContent = s));
      engineReady = true;
      els.engineStatus.textContent = '⚙️ ' + name;
    } catch (err) {
      els.engineStatus.textContent =
        '⚠️ Could not load Stockfish (offline?). Reload the page to retry.';
      console.error(err);
    }
  }

  boot();
})();
