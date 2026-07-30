/*
 * DragonFish main-thread controller (beta) — renders the amazon-variant board
 * from FEN, handles clicks against the worker-provided legal move list, and
 * relays sounds/feed events. Completely independent of the chess.js game flow.
 */
/* global sound */

const DragonMode = (() => {
  let worker = null;
  let els = null;
  let hooks = null; // { logMove, logEvent, setStatus, playSound, onGameEnd }
  let active = false;
  let state = null; // last state msg from worker
  let selected = null;
  let lastMove = null;
  let playerColor = 'w';
  let thinking = false;
  let gameOver = false;

  const DRAGON_CDN_PIECES =
    'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/';

  function ensureWorker() {
    if (worker) return;
    worker = new Worker('js/dragon-worker.js?v=10');
    worker.onmessage = (e) => handleMsg(e.data);
    worker.onerror = (e) => {
      hooks.setStatus('🐉 DragonFish failed to load: ' + (e.message || 'worker error'));
    };
  }

  function handleMsg(msg) {
    if (!active) return;
    if (msg.type === 'fatal') {
      hooks.setStatus('🐉 DragonFish could not start (beta): ' + msg.error);
      return;
    }
    if (msg.type === 'ready') {
      hooks.logEvent('🐉 Fairy-Stockfish rules loaded (amazon variant).');
      return;
    }
    if (msg.type !== 'state') return;
    state = msg;

    if (msg.playerMove) {
      lastMove = msg.playerMove.uci;
      hooks.logMove('You', msg.playerMove.san);
      hooks.playSound(msg.playerMove.captured ? 'capture' : 'move');
      if (msg.inCheck) hooks.playSound('check');
    }
    if (msg.engineMove) {
      thinking = false;
      lastMove = msg.engineMove.uci;
      hooks.logMove('DragonFish', msg.engineMove.san);
      hooks.playSound(msg.engineMove.captured ? 'capture' : 'move');
      if (msg.inCheck) hooks.playSound('check');
    }

    render();

    if (msg.over) {
      gameOver = true;
      let text;
      if (msg.result === 'draw') text = '🤝 Draw.';
      else if (msg.result === playerColor) text = '🏆 Checkmate — you slayed the DragonFish!';
      else text = '💀 Checkmate — DragonFish wins.';
      hooks.setStatus(text);
      hooks.logEvent(text);
      hooks.playSound(msg.result === 'draw' ? 'draw' : msg.result === playerColor ? 'victory' : 'defeat');
      hooks.onGameEnd();
      return;
    }

    if (msg.turn !== playerColor && !thinking) {
      thinking = true;
      hooks.setStatus('🐉 DragonFish is thinking…');
      worker.postMessage({ type: 'think' });
    } else if (msg.turn === playerColor) {
      hooks.setStatus('Your move.');
    }
  }

  /* ---------- rendering ---------- */

  function fenToMap(fen) {
    const map = {};
    const rows = fen.split(' ')[0].split('/');
    for (let r = 0; r < rows.length; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) f += parseInt(ch, 10);
        else {
          map['abcdefgh'[f] + (8 - r)] = ch;
          f++;
        }
      }
    }
    return map;
  }

  function pieceEl(ch) {
    const isWhite = ch === ch.toUpperCase();
    const lower = ch.toLowerCase();
    if (lower === 'a') {
      const span = document.createElement('span');
      span.className = 'dragon-piece ' + (isWhite ? 'dragon-white' : 'dragon-black');
      span.textContent = '🐉';
      return span;
    }
    const img = document.createElement('img');
    img.className = 'piece-img';
    img.draggable = false;
    const name = (isWhite ? 'w' : 'b') + lower.toUpperCase() + '.svg';
    img.src = 'img/pieces/' + name;
    img.onerror = () => {
      img.onerror = null;
      img.src = DRAGON_CDN_PIECES + name;
    };
    return img;
  }

  function render() {
    if (!state) return;
    const map = fenToMap(state.fen);
    const flipped = playerColor === 'b';
    const targets = new Set(
      selected ? state.moves.filter((m) => m.startsWith(selected)).map((m) => m.slice(2, 4)) : []
    );
    els.board.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const rr = flipped ? 7 - r : r;
        const ff = flipped ? 7 - f : f;
        const sq = 'abcdefgh'[ff] + (8 - rr);
        const cell = document.createElement('div');
        cell.className = 'sq ' + ((rr + ff) % 2 === 0 ? 'light' : 'dark');
        cell.dataset.sq = sq;
        const ch = map[sq];
        if (ch) cell.appendChild(pieceEl(ch));
        if (selected === sq) cell.classList.add('selected');
        if (targets.has(sq)) cell.classList.add(ch ? 'capture-target' : 'move-target');
        if (lastMove && (lastMove.slice(0, 2) === sq || lastMove.slice(2, 4) === sq)) {
          cell.classList.add('last-move');
        }
        if (
          state.inCheck &&
          ch &&
          ch.toLowerCase() === 'k' &&
          (ch === ch.toUpperCase() ? 'w' : 'b') === state.turn
        ) {
          cell.classList.add('in-check');
        }
        cell.addEventListener('click', () => onClick(sq, ch));
        if (ch && (ch === ch.toUpperCase() ? 'w' : 'b') === playerColor) {
          cell.addEventListener('pointerdown', (e) => startDrag(e, sq, ch, cell));
        }
        els.board.appendChild(cell);
      }
    }
  }

  function startDrag(e, sq, ch, cell) {
    if (!active || gameOver || thinking || !state || state.turn !== playerColor) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    selected = sq;
    els.board.querySelectorAll('.sq').forEach((c) =>
      c.classList.remove('selected', 'move-target', 'capture-target')
    );
    cell.classList.add('selected');
    for (const m of state.moves.filter((mv) => mv.startsWith(sq))) {
      const t = els.board.querySelector(`.sq[data-sq="${m.slice(2, 4)}"]`);
      if (t) t.classList.add(t.querySelector('.piece-img, .dragon-piece') ? 'capture-target' : 'move-target');
    }
    const pieceNode = cell.querySelector('.piece-img, .dragon-piece');
    let ghost = null;
    const size = cell.getBoundingClientRect().width;
    const onMove = (ev) => {
      if (!ghost && pieceNode) {
        ghost = pieceNode.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = size + 'px';
        ghost.style.height = size + 'px';
        document.body.appendChild(ghost);
        pieceNode.style.opacity = '0.35';
      }
      if (ghost) {
        ghost.style.left = ev.clientX - size / 2 + 'px';
        ghost.style.top = ev.clientY - size / 2 + 'px';
      }
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (ghost) ghost.remove();
      if (pieceNode) pieceNode.style.opacity = '';
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const dropCell = el && el.closest ? el.closest('.sq') : null;
      const dropSq = dropCell && dropCell.dataset ? dropCell.dataset.sq : null;
      if (dropSq && dropSq !== sq) onClick(dropSq, null);
      else render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function onClick(sq, ch) {
    if (!active || gameOver || thinking || !state || state.turn !== playerColor) return;
    if (ch === null) ch = fenToMap(state.fen)[sq] || undefined;
    const mine = ch && (ch === ch.toUpperCase() ? 'w' : 'b') === playerColor;
    if (selected) {
      if (sq === selected) {
        selected = null;
        render();
        return;
      }
      const candidates = state.moves.filter(
        (m) => m.slice(0, 2) === selected && m.slice(2, 4) === sq
      );
      if (candidates.length) {
        // Promotions: prefer dragon, then queen (beta: no picker in this mode).
        const uci =
          candidates.find((m) => m.length > 4 && m[4] === 'a') ||
          candidates.find((m) => m.length > 4 && m[4] === 'q') ||
          candidates[0];
        selected = null;
        worker.postMessage({ type: 'push', uci });
        return;
      }
    }
    selected = mine ? sq : null;
    render();
  }

  /* ---------- public API ---------- */

  return {
    isActive: () => active,
    start(elements, callbacks, color) {
      els = elements;
      hooks = callbacks;
      playerColor = color;
      active = true;
      selected = null;
      lastMove = null;
      thinking = false;
      gameOver = false;
      ensureWorker();
      hooks.setStatus('🐉 Loading Fairy-Stockfish rules…');
      if (state) {
        worker.postMessage({ type: 'new' });
      }
      // If the worker is still booting, its first state message starts the game.
    },
    stop() {
      active = false;
    },
    undo() {
      if (!active || thinking || !state) return;
      gameOver = false;
      selected = null;
      lastMove = null;
      hooks.logEvent('↩️ Move taken back.');
      worker.postMessage({ type: 'undo', count: 2 });
    },
    resign() {
      if (!active || gameOver) return;
      gameOver = true;
      const msg = '🏳️ You resigned. DragonFish wins.';
      hooks.playSound('defeat');
      hooks.setStatus(msg);
      hooks.logEvent(msg);
      hooks.onGameEnd();
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DragonMode };
}
