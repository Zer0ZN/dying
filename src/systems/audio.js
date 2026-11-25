/**
 * Ambient score.
 *
 * The brief asks for "the rescue" by Antent / Nectry as the soundtrack. That
 * is a licensed recording, so this module does NOT ship it. It works in two
 * modes, decided at runtime:
 *
 *   1. FILE — if `assets/the-rescue.mp3` (or .ogg / .m4a / .wav) exists next
 *      to index.html it is streamed, looped and used as the soundtrack. Drop a
 *      licensed copy there and the scene plays it.
 *   2. PROCEDURAL — otherwise an original ambient piece plays, written for this
 *      room: a cold minor-key pad, sparse felt-piano notes with a long tail, a
 *      low lake wind and a distant sub pulse. It is synthesised live with
 *      WebAudio, so it costs no bandwidth and loops forever.
 *
 * Either way nothing sounds until the visitor asks for it — browsers block
 * autoplay, and a scene about solitude should not start shouting on load.
 */

const CANDIDATES = [
  'assets/the-rescue.mp3',
  'assets/the-rescue.ogg',
  'assets/the-rescue.m4a',
  'assets/the-rescue.wav',
];

export class Ambient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.started = false;
    this.muted = true;
    this.mode = 'procedural';
    this.audioEl = null;
    this._timers = [];
    this._nodes = [];
    this._fileChecked = false;
    this._fileUrl = null;
    this._volume = 0.55;
  }

  /* ---------------------------------------------------------------- */
  /*  file probing                                                     */
  /* ---------------------------------------------------------------- */

  async _probeFile() {
    if (this._fileChecked) return this._fileUrl;
    this._fileChecked = true;
    for (const url of CANDIDATES) {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          const len = Number(res.headers.get('content-length') || 0);
          if (len > 1024) { this._fileUrl = url; break; }
        }
      } catch (e) { /* not there, try the next */ }
    }
    return this._fileUrl;
  }

  /* ---------------------------------------------------------------- */

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);

    // One shared convolution send — the room is a wooden cabin, so the tail
    // is short and dark rather than a cathedral.
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(3.6, 3.1);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.5;
    this.verb.connect(this.verbGain).connect(this.master);

    await this._probeFile();
    if (this._fileUrl) {
      this.mode = 'file';
      this._setupFile();
    } else {
      this.mode = 'procedural';
      this._setupProcedural();
    }
    this.started = true;
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  _setupFile() {
    const el = new Audio(this._fileUrl);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    el.volume = 0.0;
    el.preload = 'auto';
    this.audioEl = el;
    try {
      const src = this.ctx.createMediaElementSource(el);
      this.fileGain = this.ctx.createGain();
      this.fileGain.gain.value = 0.95;
      src.connect(this.fileGain).connect(this.master);
    } catch (e) {
      this.fileGain = null; // fall back to the element's own volume
    }
  }

  /* ---------------------------------------------------------------- */
  /*  procedural score                                                 */
  /* ---------------------------------------------------------------- */

  _setupProcedural() {
    const ctx = this.ctx;

    // --- wind: brown-ish noise through a low pass, breathing slowly
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      nd[i] = last * 3.4;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    const windLP = ctx.createBiquadFilter();
    windLP.type = 'lowpass';
    windLP.frequency.value = 380;
    windLP.Q.value = 0.35;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.13;
    wind.connect(windLP).connect(windGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.038;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.075;
    lfo.connect(lfoGain).connect(windGain.gain);
    lfo.start();
    wind.start();
    this._nodes.push(wind, lfo);

    // --- pad bed: A minor add9, spread wide and filtered dark
    const padBus = ctx.createGain();
    padBus.gain.value = 0.0;
    padBus.connect(this.master);
    padBus.connect(this.verb);
    this.padBus = padBus;

    const padNotes = [110.0, 130.81, 164.81, 196.0, 246.94];
    this.padOsc = padNotes.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 2) * 5;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i / (padNotes.length - 1)) * 1.5 - 0.75;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 620 + i * 110;
      o.connect(g).connect(lp).connect(pan).connect(padBus);
      o.start();
      this._nodes.push(o);
      return { o, g, lp };
    });
    padBus.gain.linearRampToValueAtTime(0.26, ctx.currentTime + 7.0);

    // --- felt piano, sparse, long tail
    this.scale = [
      220.0, 261.63, 293.66, 329.63, 392.0, 440.0,
      523.25, 587.33, 659.25, 783.99, 880.0,
    ];
    this._nextNoteAt = ctx.currentTime + 2.4;
    this._noteTimer = setInterval(() => this._scheduleNotes(), 400);
    this._timers.push(this._noteTimer);
  }

  _scheduleNotes() {
    if (!this.ctx || this.mode !== 'procedural') return;
    const now = this.ctx.currentTime;
    while (this._nextNoteAt < now + 4.0) {
      this._playNote(this._nextNoteAt);
      // Irregular spacing: a phrase, then a long gap. Regular beats would
      // turn this into a loop; the piece this borrows its mood from breathes.
      const r = Math.random();
      const gap = r < 0.55 ? 1.9 + Math.random() * 2.2 : 3.4 + Math.random() * 4.6;
      this._nextNoteAt += gap;
    }
  }

  _playNote(t) {
    const ctx = this.ctx;
    let idx;
    const r = Math.random();
    if (r < 0.58) idx = Math.floor(Math.random() * 4);
    else if (r < 0.88) idx = 2 + Math.floor(Math.random() * 5);
    else idx = 7 + Math.floor(Math.random() * 4);
    const freq = this.scale[idx];

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    // A quiet detuned octave gives the felt-piano body without a hard attack.
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2.003;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;

    const env = ctx.createGain();
    const vel = 0.085 + Math.random() * 0.085;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0006, t + 3.8 + Math.random() * 2.6);

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(1900, t);
    tone.frequency.exponentialRampToValueAtTime(620, t + 2.8);

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.2;

    o1.connect(env);
    o2.connect(g2).connect(env);
    env.connect(tone).connect(pan);
    pan.connect(this.master);
    pan.connect(this.verb);

    o1.start(t); o2.start(t);
    const stop = t + 6.5;
    o1.stop(stop); o2.stop(stop);
    o1.onended = () => {
      try { o1.disconnect(); o2.disconnect(); env.disconnect(); } catch (e) { /* gone */ }
    };
  }

  /* ---------------------------------------------------------------- */

  /** Toggle the score. Returns the new muted state. */
  async toggle(force) {
    if (!this.ctx) await this.init();
    const shouldPlay = force !== undefined ? !!force : this.muted;
    this.muted = !shouldPlay;

    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(shouldPlay ? this._volume : 0.0, now + 1.8);

    if (this.mode === 'file' && this.audioEl) {
      if (shouldPlay) {
        this.audioEl.play().catch(() => {});
        if (this.fileGain) {
          this.fileGain.gain.cancelScheduledValues(now);
          this.fileGain.gain.linearRampToValueAtTime(0.95, now + 1.8);
        }
      } else {
        // let the master fade first, then stop the element
        setTimeout(() => { if (this.muted && this.audioEl) this.audioEl.pause(); }, 1900);
      }
    }
    return this.muted;
  }

  get playing() { return !this.muted && this.started; }

  dispose() {
    for (const t of this._timers) clearInterval(t);
    for (const n of this._nodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
    if (this.ctx) this.ctx.close();
  }
}
