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

  /**
   * Check alert. Lichess has no check sound (their Check.mp3 is literally a
   * symlink to Silence.mp3), so we synthesize a short rising two-tone chime.
   */
  _checkChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = this.ctx || new Ctx();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(740, t);
      o.frequency.setValueAtTime(988, t + 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t);
      o.stop(t + 0.45);
    } catch (e) { /* no WebAudio — stay silent */ }
  }

  play(name) {
    if (!this.enabled) return;
    if (name === 'check') return this._checkChime();
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
