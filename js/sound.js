/*
 * Board sounds — lichess's standard set (lila repo, AGPL project assets),
 * vendored locally by the deploy workflow with lichess's GitHub copy as
 * fallback. Missing files degrade gracefully (fall back to the move sound,
 * then to silence).
 */

const SOUND_FILES = {
  move: 'Move.mp3',
  capture: 'Capture.mp3',
  start: 'GenericNotify.mp3',
  victory: 'Victory.mp3',
  defeat: 'Defeat.mp3',
  draw: 'Draw.mp3',
};
const SOUND_CDN =
  'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/';
const SOUND_FALLBACK = { victory: 'start', defeat: 'start', draw: 'start' };

class SoundBox {
  constructor() {
    let pref = null;
    try { pref = localStorage.getItem('fishtank-sound'); } catch (e) { /* private mode */ }
    this.enabled = pref !== 'off';
    this.cache = {};
    this.dead = new Set();
  }

  _audio(name) {
    if (this.cache[name]) return this.cache[name];
    const file = SOUND_FILES[name];
    if (!file) return null;
    const a = new Audio('sound/' + file);
    a.preload = 'auto';
    let triedCdn = false;
    a.addEventListener('error', () => {
      if (!triedCdn) {
        triedCdn = true;
        a.src = SOUND_CDN + file;
      } else {
        this.dead.add(name);
      }
    });
    this.cache[name] = a;
    return a;
  }

  play(name) {
    if (!this.enabled) return;
    // No check sound — matching lichess, checks are silent (regular move
    // and capture sounds still play).
    if (name === 'check') return;
    if (this.dead.has(name)) {
      const fb = SOUND_FALLBACK[name];
      if (!fb || this.dead.has(fb)) return;
      name = fb;
    }
    const a = this._audio(name);
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* autoplay restrictions etc. — never break the game */ }
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('fishtank-sound', this.enabled ? 'on' : 'off'); } catch (e) {}
    return this.enabled;
  }

  /** Warm the cache so the first move doesn't lag. */
  preload() {
    for (const name of Object.keys(SOUND_FILES)) this._audio(name);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SoundBox, SOUND_FILES };
}
