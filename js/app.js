/* FishTank — main app: board UI, game loop, variant wiring. */
/* global Chess, VARIANTS, randomMoveProbability, clampUciElo, ELO_MIN, ELO_MAX, SillyEngine, SoundBox */

(() => {
  // cburnett SVG pieces (CC BY-SA 3.0) — same look locally and deployed:
  // vendored files first, lichess's GitHub copy as automatic fallback.
  const CDN_PIECE_BASE =
    'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/';
  let PIECE_BASE = 'img/pieces/';
  {
    const probe = new Image();
    probe.onerror = () => { PIECE_BASE = CDN_PIECE_BASE; };
    probe.src = 'img/pieces/wK.svg';
  }

  const els = {
    picker: document.getElementById('picker'),
    cards: document.getElementById('variant-cards'),
    game: document.getElementById('game'),
    board: document.getElementById('board'),
    log: document.getElementById('log'),
    eloBar: document.getElementById('elo-bar'),
    mood: document.getElementById('mood'),
    oppName: document.getElementById('opp-name'),
    oppDesc: document.getElementById('opp-desc'),
    status: document.getElementById('status'),
    engineStatus: document.getElementById('engine-status'),
    btnNew: document.getElementById('btn-new'),
    btnSwitch: document.getElementById('btn-switch'),
    btnUndo: document.getElementById('btn-undo'),
    btnResign: document.getElementById('btn-resign'),
    btnRematch: document.getElementById('btn-rematch'),
    btnSound: document.getElementById('btn-sound'),
    sideSelect: document.getElementById('side-select'),
  };

  let engine = null;
  let engineReady = false;
  const sound = new SoundBox();
  let game = null; // chess.js instance
  let variant = null;
  let vstate = null; // { elo, moveCount, ... }
  let playerColor = 'w';
  let selectedSquare = null;
  let thinking = false;
  let gameOver = false;

  /* ---------- variant picker ---------- */

  function demoRows(v) {
    return (v.demo || [])
      .map(([move, elo, delta]) => {
        let cls = 'ev-delta';
        if (delta.startsWith('−') || delta.startsWith('-')) cls += ' neg';
        else if (delta.startsWith('+')) cls += ' pos';
        else if (delta) cls += ' dice';
        return (
          `<div class="ev"><span class="ev-move">${move}</span>` +
          `<span class="ev-elo">${elo}</span>` +
          `<span class="${cls}">${delta}</span></div>`
        );
      })
      .join('');
  }

  function buildPicker() {
    els.cards.innerHTML = '';
    for (const v of Object.values(VARIANTS)) {
      const card = document.createElement('button');
      card.className = 'card';
      card.innerHTML =
        `<div class="thumb">` +
        `<div class="thumb-evals">${demoRows(v)}</div>` +
        `<img class="thumb-fish" src="img/stockfish.png" alt="" onerror="this.remove()">` +
        `<span class="thumb-emoji">${v.emoji}</span>` +
        `</div>` +
        `<div class="card-name">${v.name}</div>` +
        `<div class="card-tag">${v.tagline}</div>`;
      card.addEventListener('click', () => startGame(v.id, true));
      els.cards.appendChild(card);
    }
  }

  /* ---------- game setup ---------- */

  function startGame(variantId, pushHistory) {
    variant = VARIANTS[variantId];
    // Each variant gets its own URL (#panicfish etc.) so the browser back
    // button returns to the picker.
    if (pushHistory && location.hash !== '#' + variantId) {
      history.pushState(null, '', '#' + variantId);
    }
    els.btnRematch.classList.add('hidden');
    vstate = { elo: variant.baseElo, moveCount: 0 };
    if (variant.init) variant.init(vstate);
    game = new Chess();
    selectedSquare = null;
    thinking = false;
    gameOver = false;
    playerColor = els.sideSelect.value === 'b' ? 'b' : 'w';

    els.picker.classList.add('hidden');
    els.game.classList.remove('hidden');
    els.oppDesc.textContent = variant.description;
    els.log.innerHTML = '';
    logEvent(`New game vs ${variant.name}. Starting Elo: ${vstate.elo}`);
    updateEloUI();
    renderBoard();
    sound.play('start');

    if (engine && engineReady) engine.newGame();

    if (playerColor === 'b') {
      setTimeout(engineMove, 400);
    } else {
      setStatus('Your move.');
    }
  }

  function showPicker() {
    els.game.classList.add('hidden');
    els.picker.classList.remove('hidden');
  }

  function goToPicker() {
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    showPicker();
  }

  function applyLocation() {
    const id = location.hash.slice(1);
    if (VARIANTS[id]) startGame(id, false);
    else showPicker();
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
          const name = piece.color + piece.type.toUpperCase() + '.svg';
          const img = document.createElement('img');
          img.className = 'piece-img';
          img.alt = piece.color + piece.type;
          img.draggable = false;
          img.src = PIECE_BASE + name;
          img.onerror = () => {
            img.onerror = null;
            img.src = CDN_PIECE_BASE + name;
          };
          cell.appendChild(img);
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
    sound.play(game.in_check() ? 'check' : move.captured ? 'capture' : 'move');
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

    let engineCaptured = false;
    if (Math.random() < pRandom) {
      const moves = game.moves({ verbose: true });
      const m = moves[Math.floor(Math.random() * moves.length)];
      await sleep(350 + Math.random() * 500);
      const played = game.move(m.san);
      san = played.san;
      engineCaptured = !!played.captured;
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
        const p2 = game.move(m.san);
        san = m.san;
        engineCaptured = !!(p2 && p2.captured);
      } else {
        san = played.san;
        engineCaptured = !!played.captured;
      }
      logMove(variant.name, san);
    }
    sound.play(game.in_check() ? 'check' : engineCaptured ? 'capture' : 'move');

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
      sound.play(winnerIsPlayer ? 'victory' : 'defeat');
    } else if (game.in_stalemate()) msg = '🤝 Stalemate.';
    else if (game.in_threefold_repetition()) msg = '🤝 Draw by repetition.';
    else if (game.insufficient_material()) msg = '🤝 Draw — insufficient material.';
    else msg = '🤝 Draw (50-move rule).';
    if (!game.in_checkmate()) sound.play('draw');
    setStatus(msg);
    logEvent(msg);
    els.btnRematch.classList.remove('hidden');
    return true;
  }

  /* ---------- undo ---------- */

  function resign() {
    if (thinking || gameOver || !game) return;
    gameOver = true;
    const msg = `🏳️ You resigned. ${variant.name} accepts smugly.`;
    sound.play('defeat');
    setStatus(msg);
    logEvent(msg);
    els.btnRematch.classList.remove('hidden');
  }

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
    els.oppName.innerHTML =
      `${variant.emoji} ${variant.name} ` +
      `<span class="opp-elo-inline">(${Math.round(vstate.elo)})</span>`;
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
    els.btnNew.addEventListener('click', () => startGame(variant.id, false));
    els.btnRematch.addEventListener('click', () => startGame(variant.id, false));
    els.btnSwitch.addEventListener('click', goToPicker);
    els.btnUndo.addEventListener('click', undo);
    els.btnResign.addEventListener('click', resign);
    window.addEventListener('popstate', applyLocation);

    const soundLabel = () => (sound.enabled ? '🔊 Sound' : '🔇 Muted');
    els.btnSound.textContent = soundLabel();
    els.btnSound.addEventListener('click', () => {
      sound.toggle();
      els.btnSound.textContent = soundLabel();
    });
    sound.preload();

    // Deep link: /#tiltfish opens straight into that game.
    applyLocation();

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
