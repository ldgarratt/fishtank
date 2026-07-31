/* FishTank — main app: board UI, game loop, variant wiring. */
/* global Chess, VARIANTS, randomMoveProbability, clampUciElo, ELO_MIN, ELO_MAX, SillyEngine, SoundBox, DragonMode, Analysis, FishArt */

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
    avatar: document.getElementById('bot-avatar'),
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
    btnPgn: document.getElementById('btn-pgn'),
    btnAnalyse: document.getElementById('btn-analyse'),
    analysis: document.getElementById('analysis'),
    sideSelect: document.getElementById('side-select'),
  };

  let engine = null;
  let engineReady = false;
  let enginePromise = null; // resolves (true/false) once loading settles
  const sound = new SoundBox();
  let game = null; // chess.js instance
  let variant = null;
  let vstate = null; // { elo, moveCount, ... }
  let playerColor = 'w';
  let selectedSquare = null;
  let thinking = false;
  let gameOver = false;
  let premove = null; // { from, to } queued while the engine thinks
  let pendingPromo = null; // { from, to } awaiting promotion piece choice
  let reviewPly = null; // null = live position; otherwise plies shown
  let reviewGame = null; // chess.js replay used while reviewing
  let liveStatus = ''; // status text to restore when leaving review

  /* ---------- variant picker ---------- */

  function buildPicker() {
    els.cards.innerHTML = '';
    for (const v of Object.values(VARIANTS)) {
      const card = document.createElement('button');
      card.className = 'card';
      card.innerHTML =
        FishArt.cardArt(v) +
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
    els.btnAnalyse.classList.add('hidden');
    els.analysis.classList.add('hidden');
    els.analysis.innerHTML = '';
    // PGN and analysis need chess.js history, which fairy mode doesn't have.
    els.btnPgn.classList.toggle('hidden', !!variant.fairy);

    // Fairy variants (DragonFish) use their own rules engine and game loop.
    if (variant.fairy) {
      DragonMode.stop();
      vstate = { elo: variant.baseElo, moveCount: 0 };
      playerColor = els.sideSelect.value === 'b' ? 'b' : 'w';
      game = null;
      gameOver = false;
      els.picker.classList.add('hidden');
      els.game.classList.remove('hidden');
      els.oppDesc.textContent = variant.description;
      els.oppName.innerHTML =
        `${variant.name} <span class="opp-elo-inline">(beta)</span>`;
      els.avatar.innerHTML = FishArt.avatar(variant);
      els.eloBar.style.width = '100%';
      els.eloBar.className = 'elo-bar elo-mid';
      els.log.innerHTML = '';
      logEvent(`New game vs ${variant.name}.`);
      sound.play('start');
      DragonMode.start(
        els,
        {
          logMove,
          logEvent,
          setStatus,
          playSound: (n) => sound.play(n),
          onGameEnd: () => els.btnRematch.classList.remove('hidden'),
        },
        playerColor
      );
      return;
    }
    DragonMode.stop();
    playerColor = els.sideSelect.value === 'b' ? 'b' : 'w';
    vstate = { elo: variant.baseElo, moveCount: 0, playerColor };
    if (variant.init) variant.init(vstate);
    game = new Chess();
    selectedSquare = null;
    thinking = false;
    gameOver = false;
    premove = null;
    pendingPromo = null;
    reviewPly = null;
    reviewGame = null;
    document.getElementById('promo').classList.add('hidden');

    els.picker.classList.add('hidden');
    els.game.classList.remove('hidden');
    els.oppDesc.textContent = variant.description;
    els.avatar.innerHTML = FishArt.avatar(variant);
    els.log.innerHTML = '';
    logEvent(`New game vs ${variant.name}. Starting Elo: ${vstate.elo}`);
    updateEloUI();
    renderBoard();
    sound.play('start');

    if (engine && engineReady) {
      engine.newGame();
      const ceiling = engine.maxRating();
      if (vstate.elo > ceiling) {
        logEvent(
          `⚠️ This engine build tops out at ${ceiling} Elo, so ratings above ` +
          `that play at ${ceiling}.`
        );
      }
    }

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

  const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  function pieceLabel(piece) {
    return (piece.color === 'w' ? 'white ' : 'black ') + PIECE_NAMES[piece.type];
  }

  function squareName(fileIdx, rankIdx) {
    return 'abcdefgh'[fileIdx] + (8 - rankIdx);
  }

  function renderBoard() {
    els.board.innerHTML = '';
    // While reviewing, the board shows a past position instead of the live one.
    const view = reviewPly === null ? game : reviewGame;
    const flipped = playerColor === 'b';
    const legalTargets = new Set();
    if (selectedSquare && reviewPly === null) {
      for (const m of game.moves({ square: selectedSquare, verbose: true })) {
        legalTargets.add(m.to);
      }
    }
    const lastMove = view.history({ verbose: true }).slice(-1)[0] || null;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rr = flipped ? 7 - r : r;
        const ff = flipped ? 7 - f : f;
        const sq = squareName(ff, rr);
        const cell = document.createElement('div');
        cell.className = 'sq ' + (((rr + ff) % 2 === 0) ? 'light' : 'dark');
        cell.dataset.sq = sq;
        const piece = view.get(sq);
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', sq + (piece ? ', ' + pieceLabel(piece) : ', empty'));
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
          if (piece.type === 'k' && variant && variant.kingLives) {
            const lives = variant.kingLives(vstate, view)[piece.color];
            const badge = document.createElement('span');
            badge.className = 'king-lives' + (lives <= 1 ? ' king-lives-low' : '');
            badge.textContent = lives;
            cell.appendChild(badge);
          }
        }
        if (selectedSquare === sq) cell.classList.add('selected');
        if (premove && (premove.from === sq || premove.to === sq)) cell.classList.add('premove');
        if (legalTargets.has(sq)) cell.classList.add(piece ? 'capture-target' : 'move-target');
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cell.classList.add('last-move');
        if (piece && piece.type === 'k' && view.in_check() && piece.color === view.turn()) {
          cell.classList.add('in-check');
        }
        cell.addEventListener('click', () => onSquareClick(sq));
        if (piece && piece.color === playerColor && reviewPly === null) {
          cell.addEventListener('pointerdown', (e) => startDrag(e, sq, cell));
        }
        els.board.appendChild(cell);
      }
    }
  }

  /* ---------- interaction ---------- */

  function onSquareClick(sq) {
    if (reviewPly !== null) {
      goToPly(null); // any click on the board jumps back to the live position
      return;
    }
    if (gameOver || !game || pendingPromo) return;
    const piece = game.get(sq);

    // Premove mode: queue a move while the engine is thinking (chess.com style).
    if (thinking || game.turn() !== playerColor) {
      if (!thinking) return;
      if (selectedSquare) {
        if (sq === selectedSquare) {
          selectedSquare = null;
          premove = null;
        } else {
          premove = { from: selectedSquare, to: sq };
          selectedSquare = null;
        }
      } else if (piece && piece.color === playerColor) {
        selectedSquare = sq;
        premove = null;
      } else {
        premove = null;
      }
      renderBoard();
      return;
    }

    if (selectedSquare) {
      if (sq === selectedSquare) {
        selectedSquare = null;
        renderBoard();
        return;
      }
      const candidates = game
        .moves({ square: selectedSquare, verbose: true })
        .filter((m) => m.to === sq);
      if (candidates.length) {
        if (candidates[0].flags.indexOf('p') !== -1) {
          showPromo(selectedSquare, sq);
          return;
        }
        const fenBefore = game.fen();
        const legalCount = game.moves().length;
        const move = game.move({ from: selectedSquare, to: sq });
        selectedSquare = null;
        afterPlayerMove(move, fenBefore, legalCount);
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

  /* ---------- drag and drop ---------- */

  function startDrag(e, sq, cell) {
    if (gameOver || pendingPromo || !game || reviewPly !== null) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();

    // Select immediately and mark legal targets in place (no rebuild — that
    // would destroy the elements mid-gesture).
    selectedSquare = sq;
    els.board.querySelectorAll('.sq').forEach((c) => {
      c.classList.remove('selected', 'move-target', 'capture-target');
    });
    cell.classList.add('selected');
    for (const m of game.moves({ square: sq, verbose: true })) {
      const target = els.board.querySelector(`.sq[data-sq="${m.to}"]`);
      if (target) target.classList.add(target.querySelector('.piece-img') ? 'capture-target' : 'move-target');
    }

    const pieceImg = cell.querySelector('.piece-img, .piece');
    let ghost = null;
    const size = cell.getBoundingClientRect().width;
    const place = (ev) => {
      if (!ghost) return;
      ghost.style.left = ev.clientX - size / 2 + 'px';
      ghost.style.top = ev.clientY - size / 2 + 'px';
    };
    const onMove = (ev) => {
      if (!ghost && pieceImg) {
        ghost = pieceImg.cloneNode(true);
        ghost.className = 'drag-ghost';
        ghost.style.width = size + 'px';
        ghost.style.height = size + 'px';
        document.body.appendChild(ghost);
        pieceImg.style.opacity = '0.35';
      }
      place(ev);
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (ghost) ghost.remove();
      if (pieceImg) pieceImg.style.opacity = '';
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const dropCell = el && el.closest ? el.closest('.sq') : null;
      const dropSq = dropCell && dropCell.dataset ? dropCell.dataset.sq : null;
      if (dropSq && dropSq !== sq) {
        onSquareClick(dropSq); // executes move / premove / promotion flow
      } else {
        renderBoard(); // plain tap: piece stays selected for click-to-move
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* ---------- promotion picker ---------- */

  function showPromo(from, to) {
    pendingPromo = { from, to };
    const promo = document.getElementById('promo');
    promo.innerHTML =
      `<div class="promo-inner">` +
      ['q', 'r', 'n', 'b']
        .map(
          (t) =>
            `<button data-p="${t}"><img src="${PIECE_BASE + playerColor + t.toUpperCase()}.svg" alt="${t}"></button>`
        )
        .join('') +
      `</div>`;
    promo.classList.remove('hidden');
    promo.querySelectorAll('button').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const pm = pendingPromo;
        pendingPromo = null;
        promo.classList.add('hidden');
        selectedSquare = null;
        const fenBefore = game.fen();
        const legalCount = game.moves().length;
        const move = game.move({ from: pm.from, to: pm.to, promotion: b.dataset.p });
        if (move) afterPlayerMove(move, fenBefore, legalCount);
        else renderBoard();
      };
    });
    promo.onclick = () => {
      // Click outside the buttons cancels.
      pendingPromo = null;
      promo.classList.add('hidden');
      selectedSquare = null;
      renderBoard();
    };
  }

  /* ---------- premove execution ---------- */

  function tryPremove() {
    if (!premove || gameOver) return;
    const pm = premove;
    premove = null;
    const candidates = game.moves({ square: pm.from, verbose: true }).filter((m) => m.to === pm.to);
    if (!candidates.length) {
      renderBoard();
      return;
    }
    // Premoved promotions auto-queen, like chess.com's default.
    const fenBefore = game.fen();
    const legalCount = game.moves().length;
    const move = game.move({ from: pm.from, to: pm.to, promotion: 'q' });
    if (move) afterPlayerMove(move, fenBefore, legalCount);
  }

  /* ---------- game loop ---------- */

  async function afterPlayerMove(move, fenBefore, legalCount) {
    reviewPly = null; // a new move always snaps back to the live position
    reviewGame = null;
    els.board.classList.remove('reviewing');
    renderBoard();
    sound.play(move.captured ? 'capture' : 'move');
    if (game.in_check()) sound.play('check');
    logMove('You', move.san);
    const events = (variant.onPlayerMove && variant.onPlayerMove(vstate, move, game)) || [];
    for (const ev of events) logEvent(ev);
    updateEloUI();

    // Hooks that need the engine (e.g. PityFish ranking every legal move).
    if (variant.onPlayerMoveAsync && engineReady) {
      thinking = true;
      setStatus(`${variant.name} is judging your move…`);
      try {
        const evs =
          (await variant.onPlayerMoveAsync(vstate, {
            move,
            game,
            engine,
            fenBefore,
            legalCount,
          })) || [];
        for (const ev of evs) logEvent(ev);
      } catch (err) {
        console.warn('async variant hook failed:', err);
      }
      thinking = false;
      updateEloUI();
    }

    if (checkGameEnd()) return;
    engineMove();
  }

  async function engineMove() {
    if (gameOver) return;
    thinking = true;
    setStatus(`${variant.name} is thinking…`);

    // The engine loads asynchronously; a deep link or a fast first move can
    // arrive before it is ready. Wait for it rather than calling a dead worker.
    if (!engineReady && enginePromise) {
      setStatus('Waiting for Stockfish to load…');
      await enginePromise;
      if (gameOver || !game) { thinking = false; return; }
      setStatus(`${variant.name} is thinking…`);
    }
    if (!engineReady) {
      // Still no engine: play a legal move so the game never hangs.
      const moves = game.moves({ verbose: true });
      if (!moves.length) { thinking = false; checkGameEnd(); return; }
      const m = moves[Math.floor(Math.random() * moves.length)];
      const played = game.move(m.san);
      logMove(variant.name, played.san + '  🎲');
      logEvent('⚠️ Engine unavailable — playing a random move.');
      sound.play(played.captured ? 'capture' : 'move');
      vstate.moveCount += 1;
      thinking = false;
      renderBoard();
      if (checkGameEnd()) return;
      setStatus('Your move.');
      tryPremove();
      return;
    }

    const events = (variant.onEngineTurnStart && variant.onEngineTurnStart(vstate, game)) || [];
    for (const ev of events) logEvent(ev);
    updateEloUI();

    // Decide whether this move is random (drunk / below-floor sputtering).
    const pBelowFloor = randomMoveProbability(vstate.elo);
    const pExtra = (variant.extraRandomChance && variant.extraRandomChance(vstate, game)) || 0;
    const pRandom = Math.min(0.95, pBelowFloor + pExtra);
    let san = null;

    let engineCaptured = false;
    let engMove = null;

    // Variants that choose their own move (DrawFish aiming for 0.00).
    let picked = null;
    if (variant.pickMove && engineReady) {
      try {
        picked = await variant.pickMove(vstate, {
          game,
          engine,
          fen: game.fen(),
          legalCount: game.moves().length,
        });
      } catch (err) {
        console.warn('pickMove failed, falling back to normal search:', err);
      }
    }

    if (picked && picked.uci) {
      const played = game.move({
        from: picked.uci.slice(0, 2),
        to: picked.uci.slice(2, 4),
        promotion: picked.uci.length > 4 ? picked.uci[4] : undefined,
      });
      if (played) {
        san = played.san;
        engMove = played;
        engineCaptured = !!played.captured;
        logMove(variant.name, san);
        for (const ev of picked.events || []) logEvent(ev);
      } else {
        picked = null; // illegal suggestion — fall through to the normal path
      }
    }

    if (picked && picked.uci && san) {
      // move already played above
    } else if (Math.random() < pRandom) {
      const moves = game.moves({ verbose: true });
      const m = moves[Math.floor(Math.random() * moves.length)];
      await sleep(350 + Math.random() * 500);
      const played = game.move(m.san);
      san = played.san;
      engMove = played;
      engineCaptured = !!played.captured;
      logMove(variant.name, san + '  🎲');
    } else {
      engine.setStrength(vstate.elo);
      const uci = await engine.bestMove(game.fen(), MOVETIME_MS);
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
        engMove = p2;
        engineCaptured = !!(p2 && p2.captured);
      } else {
        san = played.san;
        engMove = played;
        engineCaptured = !!played.captured;
      }
      logMove(variant.name, san);
    }
    sound.play(engineCaptured ? 'capture' : 'move');
    if (game.in_check()) sound.play('check');

    const engEvents =
      (variant.onEngineMovePlayed && variant.onEngineMovePlayed(vstate, engMove, game)) || [];
    for (const ev of engEvents) logEvent(ev);

    vstate.moveCount += 1;
    thinking = false;
    renderBoard();
    updateEloUI();
    if (checkGameEnd()) return;
    setStatus('Your move.');
    tryPremove();
  }

  // Always give the limiter full thinking time: UCI_Elo's calibration assumes
  // it, and our single-threaded WASM build is already ~10x slower than native.
  // Starving it makes nominal ratings play far below par.
  const MOVETIME_MS = 800;

  function checkGameEnd() {
    // Variant-specific win conditions (e.g. three-check) take precedence.
    if (variant.checkCustomEnd) {
      const res = variant.checkCustomEnd(vstate, game);
      if (res) {
        gameOver = true;
        premove = null;
        sound.play(res.winner === 'player' ? 'victory' : res.winner === 'engine' ? 'defeat' : 'draw');
        setStatus(res.msg);
        logEvent(res.msg);
        els.btnRematch.classList.remove('hidden');
        return true;
      }
    }
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
    offerAnalysis();
    return true;
  }

  /* ---------- PGN + analysis ---------- */

  function buildPgn() {
    if (!game) return '';
    const white = playerColor === 'w' ? 'You' : variant.name;
    const black = playerColor === 'w' ? variant.name : 'You';
    let result = '*';
    if (game.in_checkmate()) result = game.turn() === 'w' ? '0-1' : '1-0';
    else if (game.game_over()) result = '1/2-1/2';
    game.header(
      'Event', 'FishTank',
      'Site', location.origin + location.pathname,
      'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      'White', white,
      'Black', black,
      'Result', result,
      'Variant', variant.name
    );
    return game.pgn({ max_width: 80, newline_char: '\n' });
  }

  async function copyPgn() {
    const pgn = buildPgn();
    if (!pgn) return;
    try {
      await navigator.clipboard.writeText(pgn);
      flashButton(els.btnPgn, '✅ Copied!', '📋 Copy PGN');
    } catch (e) {
      // Clipboard blocked (http, permissions) — fall back to a prompt.
      window.prompt('Copy the PGN:', pgn);
    }
  }

  function flashButton(btn, temp, restore) {
    btn.textContent = temp;
    setTimeout(() => (btn.textContent = restore), 1600);
  }

  function offerAnalysis() {
    if (variant.fairy || !game || game.history().length < 2 || !engineReady) return;
    els.btnAnalyse.classList.remove('hidden');
  }

  async function analyseGame() {
    if (!game || !engineReady) return;
    const history = game.history({ verbose: true });
    if (!history.length) return;
    els.btnAnalyse.disabled = true;
    els.analysis.classList.remove('hidden');
    els.analysis.innerHTML =
      '<h2>Analysis</h2><div class="an-progress"><div class="an-bar" style="width:0%"></div></div>' +
      '<div class="an-note">Analysing every position with Stockfish…</div>';
    const bar = els.analysis.querySelector('.an-bar');

    try {
      const report = await Analysis.run(engine, history, (done, total) => {
        bar.style.width = Math.round((done / total) * 100) + '%';
      });
      renderAnalysis(report);
    } catch (err) {
      els.analysis.innerHTML = '<h2>Analysis</h2><div class="an-note">Analysis failed: ' + err + '</div>';
    } finally {
      els.btnAnalyse.disabled = false;
      engine.lastElo = null; // force strength reconfiguration for the next game
    }
  }

  function evalGraph(graph) {
    if (!graph.length) return '';
    const W = 300, H = 70, CLAMP = 800;
    const pts = graph.map((cp, i) => {
      const x = (i / Math.max(1, graph.length - 1)) * W;
      const v = Math.max(-CLAMP, Math.min(CLAMP, cp));
      const y = H / 2 - (v / CLAMP) * (H / 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return (
      `<svg class="an-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      `<rect x="0" y="0" width="${W}" height="${H / 2}" fill="rgba(255,255,255,0.06)"/>` +
      `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>` +
      `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>` +
      `</svg>`
    );
  }

  function renderAnalysis(report) {
    const mySide = playerColor;
    const theirSide = playerColor === 'w' ? 'b' : 'w';
    const me = report.summary[mySide];
    const them = report.summary[theirSide];
    const row = (label, s) =>
      `<div class="an-side"><div class="an-side-name">${label}</div>` +
      `<div class="an-acc">${s.accuracy.toFixed(1)}%</div>` +
      `<div class="an-counts">` +
      `<span class="an-c blunder">${s.counts.blunder} ??</span>` +
      `<span class="an-c mistake">${s.counts.mistake} ?</span>` +
      `<span class="an-c inaccuracy">${s.counts.inaccuracy} ?!</span>` +
      `<span class="an-c acpl">${s.acpl} acpl</span></div></div>`;

    const notable = report.moves
      .filter((m) => m.cls.key === 'blunder' || m.cls.key === 'mistake' || m.cls.key === 'inaccuracy')
      .map(
        (m) =>
          `<div class="an-move ${m.cls.key}">` +
          `<span class="an-badge">${m.cls.icon}</span>` +
          `<span class="an-san">${m.n}${m.color === 'w' ? '.' : '...'} ${m.san}</span>` +
          `<span class="an-loss">−${(m.loss / 100).toFixed(1)}</span>` +
          (m.best ? `<span class="an-best">best: ${m.best}</span>` : '') +
          `</div>`
      )
      .join('');

    els.analysis.innerHTML =
      '<h2>Analysis</h2>' +
      `<div class="an-summary">${row('You', me)}${row(variant.name, them)}</div>` +
      evalGraph(report.graph) +
      (notable
        ? `<div class="an-moves">${notable}</div>`
        : '<div class="an-note">No mistakes worth mentioning. Clean game.</div>');
  }

  /* ---------- undo ---------- */

  function resign() {
    if (thinking || gameOver || !game) return;
    gameOver = true;
    premove = null;
    const msg = `🏳️ You resigned. ${variant.name} wins.`;
    sound.play('defeat');
    setStatus(msg);
    logEvent(msg);
    els.btnRematch.classList.remove('hidden');
    offerAnalysis();
  }

  function undo() {
    if (thinking || !game) return;
    // Undo engine reply + player move so it's the player's turn again.
    if (game.history().length === 0) return;
    game.undo();
    if (game.turn() !== playerColor && game.history().length > 0) game.undo();
    gameOver = false;
    selectedSquare = null;
    premove = null;
    reviewPly = null;
    reviewGame = null;
    logEvent('↩️ Move taken back (Elo effects are not refunded).');
    renderBoard();
    setStatus('Your move.');
  }

  /* ---------- move navigation (arrow keys, lichess style) ---------- */

  function positionAt(ply) {
    const replay = new Chess();
    const history = game.history();
    for (let i = 0; i < ply; i++) replay.move(history[i]);
    return replay;
  }

  /** ply === null returns to the live position. */
  function goToPly(ply) {
    if (!game) return;
    const total = game.history().length;
    if (ply === null || ply >= total) {
      reviewPly = null;
      reviewGame = null;
      renderBoard();
      els.board.classList.remove('reviewing');
      setStatus(liveStatus);
      return;
    }
    reviewPly = Math.max(0, ply);
    reviewGame = positionAt(reviewPly);
    selectedSquare = null;
    renderBoard();
    els.board.classList.add('reviewing');
    els.status.textContent =
      `⏪ Move ${reviewPly} of ${total} — press → for the live position`;
  }

  function stepReview(delta) {
    if (!game) return;
    const total = game.history().length;
    if (!total) return;
    const current = reviewPly === null ? total : reviewPly;
    goToPly(Math.min(total, Math.max(0, current + delta)));
  }

  function onKeyDown(e) {
    if (els.game.classList.contains('hidden')) return; // picker is showing
    if (!game) return; // fairy mode keeps its own board
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft': stepReview(-1); break;
      case 'ArrowRight': stepReview(1); break;
      case 'ArrowUp': case 'Home': goToPly(0); break;
      case 'ArrowDown': case 'End': goToPly(null); break;
      default: return;
    }
    e.preventDefault();
  }

  /* ---------- UI helpers ---------- */

  function updateEloUI() {
    const label = variant.eloLabel ? variant.eloLabel(vstate) : Math.round(vstate.elo);
    els.oppName.innerHTML =
      `${variant.name} <span class="opp-elo-inline">(${label})</span>`;
    const span = ELO_MAX - 800; // display floor at 800 so the bar can visibly empty
    const pct = Math.max(0, Math.min(1, (vstate.elo - 800) / span));
    els.eloBar.style.width = (pct * 100).toFixed(1) + '%';
    els.eloBar.className = 'elo-bar ' + (pct > 0.66 ? 'elo-high' : pct > 0.33 ? 'elo-mid' : 'elo-low');
  }


  function logMove(who, san) {
    const div = document.createElement('div');
    div.className = 'log-move';
    const n = game ? Math.ceil(game.history().length / 2) + '. ' : '';
    div.textContent = `${n}${who}: ${san}`;
    els.log.prepend(div);
  }

  function logEvent(text) {
    const div = document.createElement('div');
    div.className = 'log-event';
    div.textContent = text;
    els.log.prepend(div);
  }

  function setStatus(text) {
    liveStatus = text;
    if (reviewPly === null) els.status.textContent = text;
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
    els.btnUndo.addEventListener('click', () =>
      variant && variant.fairy ? DragonMode.undo() : undo()
    );
    els.btnResign.addEventListener('click', () =>
      variant && variant.fairy ? DragonMode.resign() : resign()
    );
    document.getElementById('home-link').addEventListener('click', (e) => {
      e.preventDefault();
      goToPicker();
    });
    document.addEventListener('keydown', onKeyDown);
    els.btnPgn.addEventListener('click', copyPgn);
    els.btnAnalyse.addEventListener('click', analyseGame);
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
    enginePromise = engine
      .init((s) => (els.engineStatus.textContent = s))
      .then((name) => {
        engineReady = true;
        els.engineStatus.textContent = '⚙️ ' + name;
        return true;
      })
      .catch((err) => {
        els.engineStatus.textContent =
          '⚠️ Could not load Stockfish (offline?). Reload the page to retry.';
        console.error(err);
        return false;
      });
    await enginePromise;
  }

  boot();
})();
