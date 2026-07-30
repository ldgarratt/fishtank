/*
 * Fish card art — dresses the Stockfish photo up in costume.
 *
 * Instead of parking an emoji next to the fish, each variant gets SVG props
 * (wigs, glasses, hats, tears...) drawn on top of a zoomed-in crop of the
 * fish's head, so the bot reads as a character.
 *
 * Coordinates are percentages of the fish box, so everything scales together:
 *   [propName, xPercent, yPercent, sizePx, rotationDeg]
 */

const FishArt = (() => {
  const svg = (vb, body, extra = '') =>
    `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;

  const PROPS = {
    // Big red clown wig — two lobes of curls either side of the head.
    clownWig: () =>
      svg(
        '0 0 100 70',
        `<g fill="#e53935">
           <circle cx="18" cy="40" r="17"/><circle cx="36" cy="24" r="18"/>
           <circle cx="58" cy="20" r="18"/><circle cx="80" cy="36" r="17"/>
           <circle cx="28" cy="55" r="13"/><circle cx="72" cy="53" r="13"/>
         </g>
         <g fill="#c62828" opacity="0.55">
           <circle cx="30" cy="30" r="6"/><circle cx="52" cy="24" r="6"/>
           <circle cx="70" cy="32" r="6"/>
         </g>`
      ),

    redNose: () =>
      svg(
        '0 0 40 40',
        `<circle cx="20" cy="20" r="18" fill="#f4443c"/>
         <circle cx="13" cy="13" r="6" fill="#ff8a80" opacity="0.85"/>`
      ),

    // Round tortoiseshell spectacles.
    glasses: () =>
      svg(
        '0 0 120 50',
        `<g fill="none" stroke="#6d4c41" stroke-width="6">
           <circle cx="30" cy="26" r="21"/><circle cx="90" cy="26" r="21"/>
           <path d="M51 26h18M9 20L0 12M111 20l9-8"/>
         </g>
         <g fill="#b3e5fc" opacity="0.35">
           <circle cx="30" cy="26" r="18"/><circle cx="90" cy="26" r="18"/>
         </g>`
      ),

    sunglasses: () =>
      svg(
        '0 0 120 46',
        `<g fill="#1a1a1a">
           <rect x="4" y="8" width="46" height="30" rx="10"/>
           <rect x="70" y="8" width="46" height="30" rx="10"/>
           <rect x="50" y="16" width="20" height="7"/>
         </g>
         <path d="M12 16l14 8" stroke="#ffffff" stroke-width="4" opacity="0.5"/>`
      ),

    bowTie: () =>
      svg(
        '0 0 100 56',
        `<g fill="#1e88e5">
           <path d="M44 28L6 6v44z"/><path d="M56 28L94 6v44z"/>
         </g>
         <rect x="41" y="18" width="18" height="20" rx="5" fill="#1565c0"/>`
      ),

    // Sleeping cap with pompom.
    nightcap: () =>
      svg(
        '0 0 100 80',
        `<path d="M12 62C12 30 34 8 62 6c14-1 22 8 20 20-4 22-20 30-34 36z" fill="#5c6bc0"/>
         <rect x="6" y="56" width="62" height="16" rx="8" fill="#e8eaf6"/>
         <circle cx="84" cy="20" r="13" fill="#e8eaf6"/>`
      ),

    zzz: () =>
      svg(
        '0 0 60 60',
        `<g fill="#e8eaf6" font-family="Georgia, serif" font-weight="700">
           <text x="26" y="26" font-size="26">z</text>
           <text x="6" y="48" font-size="20">z</text>
           <text x="40" y="52" font-size="14">z</text>
         </g>`
      ),

    dunceCap: () =>
      svg(
        '0 0 80 96',
        `<path d="M40 2l30 84H10z" fill="#ffca28"/>
         <path d="M40 2l30 84H40z" fill="#ffb300"/>
         <circle cx="40" cy="6" r="7" fill="#fff59d"/>
         <text x="40" y="72" font-size="34" font-weight="800" fill="#6d4c41"
               text-anchor="middle" font-family="Georgia, serif">D</text>`
      ),

    partyHorn: () =>
      svg(
        '0 0 90 50',
        `<path d="M4 34l70-22 6 14-64 22z" fill="#ffca28"/>
         <path d="M74 12l14-6-4 22-10-2z" fill="#ef5350"/>`
      ),

    beerMug: () =>
      svg(
        '0 0 80 90',
        `<rect x="10" y="26" width="46" height="58" rx="7" fill="#ffb300" opacity="0.92"/>
         <rect x="10" y="26" width="46" height="58" rx="7" fill="none" stroke="#e0e0e0" stroke-width="4"/>
         <path d="M56 40h10a12 12 0 010 24H56z" fill="none" stroke="#e0e0e0" stroke-width="5"/>
         <g fill="#fffde7">
           <circle cx="20" cy="24" r="12"/><circle cx="36" cy="18" r="14"/><circle cx="50" cy="24" r="11"/>
         </g>
         <g fill="#fff8e1" opacity="0.7">
           <circle cx="24" cy="50" r="4"/><circle cx="40" cy="62" r="3"/><circle cx="30" cy="70" r="3.5"/>
         </g>`
      ),

    devilHorns: () =>
      svg(
        '0 0 110 50',
        `<g fill="#d32f2f">
           <path d="M8 46C4 24 12 8 30 2c-6 14-4 28 4 44z"/>
           <path d="M102 46c4-22-4-38-22-44 6 14 4 28-4 44z"/>
         </g>`
      ),

    angerVeins: () =>
      svg(
        '0 0 60 60',
        `<g stroke="#e53935" stroke-width="7" stroke-linecap="round" fill="none">
           <path d="M10 22L30 6l20 16M10 24L30 40l20-16"/>
         </g>`
      ),

    sweat: () =>
      svg(
        '0 0 40 60',
        `<path d="M20 2C10 20 4 30 4 40a16 16 0 0032 0C36 30 30 20 20 2z" fill="#4fc3f7"/>
         <ellipse cx="14" cy="38" rx="5" ry="8" fill="#b3e5fc" opacity="0.8"/>`
      ),

    tears: () =>
      svg(
        '0 0 70 90',
        `<g fill="#29b6f6">
           <path d="M18 6c-8 26-14 40-14 52a14 14 0 0028 0c0-12-6-26-14-52z"/>
           <path d="M54 26c-6 20-10 30-10 40a10 10 0 0020 0c0-10-4-20-10-40z" opacity="0.85"/>
         </g>`
      ),

    halo: () =>
      svg(
        '0 0 120 40',
        `<ellipse cx="60" cy="20" rx="52" ry="15" fill="none" stroke="#ffd54f" stroke-width="9"/>
         <ellipse cx="60" cy="20" rx="52" ry="15" fill="none" stroke="#fff9c4" stroke-width="3"/>`
      ),

    flower: () =>
      svg(
        '0 0 60 60',
        `<g fill="#f8bbd0">
           <circle cx="30" cy="12" r="11"/><circle cx="30" cy="48" r="11"/>
           <circle cx="12" cy="30" r="11"/><circle cx="48" cy="30" r="11"/>
         </g>
         <circle cx="30" cy="30" r="10" fill="#ffd54f"/>`
      ),

    crown: () =>
      svg(
        '0 0 100 60',
        `<path d="M6 54L14 12l20 20L50 6l16 26 20-20 8 42z" fill="#ffca28"/>
         <rect x="6" y="46" width="88" height="12" rx="4" fill="#ffb300"/>
         <g fill="#e53935"><circle cx="30" cy="52" r="4"/><circle cx="50" cy="52" r="4"/><circle cx="70" cy="52" r="4"/></g>`
      ),

    dice: () =>
      svg(
        '0 0 60 60',
        `<rect x="2" y="2" width="56" height="56" rx="12" fill="#fafafa" stroke="#bdbdbd" stroke-width="3"/>
         <g fill="#212121"><circle cx="18" cy="18" r="6"/><circle cx="42" cy="18" r="6"/>
           <circle cx="30" cy="30" r="6"/><circle cx="18" cy="42" r="6"/><circle cx="42" cy="42" r="6"/></g>`
      ),

    sharkFin: () =>
      svg(
        '0 0 90 60',
        `<path d="M6 58C24 46 48 26 72 2c8 22 10 40 12 56z" fill="#546e7a"/>
         <path d="M40 58c14-16 26-30 32-42 4 16 6 30 8 42z" fill="#78909c"/>`
      ),

    bloodDrip: () =>
      svg(
        '0 0 60 40',
        `<path d="M0 0h60v14c-10 10-18 2-30 12S8 20 0 14z" fill="#c62828"/>`
      ),

    // Shield for hiding behind.
    shield: () =>
      svg(
        '0 0 80 96',
        `<path d="M40 2l36 12v34c0 26-18 40-36 46C22 88 4 74 4 48V14z" fill="#78909c"/>
         <path d="M40 12l26 9v27c0 19-13 30-26 35z" fill="#90a4ae"/>`
      ),

    checkMarks: () =>
      svg(
        '0 0 60 130',
        `<g fill="none" stroke="#66bb6a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
           <path d="M8 22l12 12L48 6"/><path d="M8 66l12 12L48 50"/>
         </g>
         <g fill="none" stroke="#bdbdbd" stroke-width="10" stroke-linecap="round" opacity="0.5">
           <path d="M8 110l12 12L48 94"/>
         </g>`
      ),

    dragonWing: () =>
      svg(
        '0 0 100 80',
        `<path d="M4 76C10 34 34 8 96 2 78 26 74 44 78 78 56 62 30 62 4 76z" fill="#8e24aa"/>
         <path d="M20 66c8-24 24-40 58-50-12 18-16 32-14 52-16-8-30-8-44-2z" fill="#ab47bc"/>`
      ),

    flame: () =>
      svg(
        '0 0 60 80',
        `<path d="M30 2c14 20 22 30 22 44a22 22 0 01-44 0C8 32 16 22 30 2z" fill="#ff7043"/>
         <path d="M30 26c7 12 11 18 11 26a11 11 0 01-22 0c0-8 4-14 11-26z" fill="#ffca28"/>`
      ),

    scales: () =>
      svg(
        '0 0 110 80',
        `<g stroke="#cfd8dc" stroke-width="6" fill="none" stroke-linecap="round">
           <path d="M55 8v52M14 24h82M14 24l-10 22M14 24l10 22M96 24l-10 22M96 24l10 22"/>
         </g>
         <g fill="none" stroke="#cfd8dc" stroke-width="6">
           <path d="M-4 46a18 12 0 0036 0"/><path d="M78 46a18 12 0 0036 0"/>
         </g>`
      ),

    skull: () =>
      svg(
        '0 0 70 76',
        `<path d="M35 2C16 2 4 16 4 34c0 12 6 20 12 24v12h38V58c6-4 12-12 12-24C66 16 54 2 35 2z" fill="#eceff1"/>
         <g fill="#263238"><ellipse cx="22" cy="34" rx="9" ry="11"/><ellipse cx="48" cy="34" rx="9" ry="11"/>
           <path d="M35 46l-6 12h12z"/></g>`
      ),

    tissueBox: () =>
      svg(
        '0 0 80 60',
        `<rect x="4" y="22" width="72" height="36" rx="6" fill="#42a5f5"/>
         <rect x="4" y="22" width="72" height="10" fill="#1e88e5"/>
         <path d="M30 24c4-16 16-20 22-6-8-2-14 2-16 8z" fill="#ffffff"/>
         <path d="M36 22c6-12 14-10 16-2z" fill="#eceff1"/>`
      ),
  };

  /** Build the HTML for one variant's card art. */
  function cardArt(v) {
    const art = v.art || {};
    const fishStyle =
      `transform:${art.transform || 'scale(1.55) rotate(-8deg)'};` +
      `object-position:${art.focus || '32% 72%'};` +
      `filter:${art.filter || 'none'}`;
    const props = (art.props || [])
      .map(([name, x, y, size, rot = 0]) => {
        const draw = PROPS[name];
        if (!draw) return '';
        return (
          `<span class="prop" style="left:${x}%;top:${y}%;width:${size}%;` +
          `transform:translate(-50%,-50%) rotate(${rot}deg)">${draw()}</span>`
        );
      })
      .join('');
    return (
      `<div class="thumb">` +
      `<div class="thumb-evals">${demoRows(v)}</div>` +
      `<div class="fish-stage ${art.anim || ''}">` +
      `<img class="thumb-fish" style="${fishStyle}" src="img/stockfish.png" alt="" onerror="this.remove()">` +
      props +
      `</div>` +
      `</div>`
    );
  }

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

  /** Avatar-sized version for the in-game bot card. */
  function avatar(v) {
    const art = v.art || {};
    const fishStyle =
      `transform:${art.transform || 'scale(1.55) rotate(-8deg)'};` +
      `object-position:${art.focus || '32% 72%'};` +
      `filter:${art.filter || 'none'}`;
    const props = (art.props || [])
      .map(([name, x, y, size, rot = 0]) => {
        const draw = PROPS[name];
        if (!draw) return '';
        return (
          `<span class="prop" style="left:${x}%;top:${y}%;width:${size}%;` +
          `transform:translate(-50%,-50%) rotate(${rot}deg)">${draw()}</span>`
        );
      })
      .join('');
    return (
      `<img style="${fishStyle}" src="img/stockfish.png" alt="" onerror="this.remove()">` + props
    );
  }

  return { PROPS, cardArt, avatar };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FishArt };
}
