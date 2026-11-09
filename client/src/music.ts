// Generative ambient music. Never repeats, reacts to the social field around the listener:
//  - alone & still   -> a slow breathing drone and rare bells
//  - people nearby   -> filter opens, bells get denser, an arpeggio fades in
//  - many & moving   -> soft pulse + shaker, faster tempo (still gentle)
// Every player has a personal tone (from their id). Nearby moving players chime their tone, panned in space.

export interface MusicField {
  intensity: number; // 0..1 (already smoothed by caller or raw – we smooth again)
  room: number; // room id -> key/mode
  level: number;
  voices: { tone: number; pan: number; gain: number; moving: boolean }[]; // nearby players
  online: number;
}

const MODES: number[][] = [
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 3, 5, 7, 10], // minor pentatonic
  [0, 2, 4, 6, 7, 9, 11], // lydian
  [0, 2, 3, 5, 7, 9, 10], // dorian
  [0, 2, 4, 7, 9, 11], // major hexatonic
  [0, 2, 3, 7, 9], // "kumoi"-like
];
const ROOTS = [50, 45, 48, 52, 43, 47, 53]; // D3 A2 C3 E3 G2 B2 F3

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Music {
  ctx: AudioContext | null = null;
  master!: GainNode;
  analyser!: AnalyserNode;
  private dry!: GainNode;
  private rev!: ConvolverNode;
  private revIn!: GainNode;
  private dly!: DelayNode;
  private dlyIn!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private droneOsc: OscillatorNode[] = [];
  private droneGain!: GainNode;
  private noise!: AudioBuffer;
  private nextStep = 0;
  private step = 0;
  private timer: number | null = null;
  enabled = false;
  private I = 0; // smoothed intensity
  private field: MusicField = { intensity: 0, room: -1, level: 0, voices: [], online: 1 };
  private root = 50;
  private mode = MODES[0];
  private pendingKey: { root: number; mode: number[] } | null = null;
  private melodyIdx = 3;
  private chord: number[] = [0, 2, 4];
  private r = rng(Date.now());

  async start() {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await ctx.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.75, ctx.currentTime, 1.2);
    if (this.timer === null) {
      this.nextStep = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 60);
    }
  }

  stop() {
    if (!this.ctx) return;
    this.enabled = false;
    const ctx = this.ctx;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    setTimeout(() => { if (!this.enabled) ctx.suspend(); }, 1500);
  }

  private init() {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.85;
    this.master.connect(comp).connect(ctx.destination);
    comp.connect(this.analyser);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    // reverb (generated impulse)
    this.rev = ctx.createConvolver();
    this.rev.buffer = this.impulse(3.2);
    this.revIn = ctx.createGain();
    this.revIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.9;
    this.revIn.connect(this.rev).connect(revOut).connect(this.master);
    // dotted-eighth-ish delay with damping
    this.dly = ctx.createDelay(2);
    this.dly.delayTime.value = 0.48;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2200;
    this.dlyIn = ctx.createGain();
    this.dlyIn.connect(this.dly).connect(damp).connect(fb).connect(this.dly);
    damp.connect(this.revIn);
    damp.connect(this.master);

    // noise buffer for shaker / wind
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // drone
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 300;
    this.droneFilter.Q.value = 0.7;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.dry);
    this.droneGain.connect(this.revIn);
    const types: OscillatorType[] = ['sine', 'triangle', 'sine', 'triangle'];
    const intervals = [0, 7, 12, 19];
    intervals.forEach((iv, i) => {
      const o = ctx.createOscillator();
      o.type = types[i];
      o.frequency.value = mtof(this.root - 12 + iv);
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.25, 0.18, 0.08][i];
      // slow breathing LFO per voice
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + i * 0.017;
      const lg = ctx.createGain(); lg.gain.value = g.gain.value * 0.5;
      lfo.connect(lg).connect(g.gain);
      lfo.start();
      o.connect(g).connect(this.droneFilter);
      o.start();
      this.droneOsc.push(o);
    });
    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 600; wf.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.012;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
    const wlg = ctx.createGain(); wlg.gain.value = 350;
    wl.connect(wlg).connect(wf.frequency); wl.start();
    wind.connect(wf).connect(wg).connect(this.revIn);
    wind.start();
  }

  private impulse(sec: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  /** called from the game loop (~every frame is fine) */
  setField(f: MusicField) {
    const roomChanged = f.room !== this.field.room;
    this.field = f;
    if (roomChanged) {
      const seed = f.room < 0 ? 999 : f.room;
      const r = rng(seed * 2654435761);
      this.pendingKey = { root: ROOTS[Math.floor(r() * ROOTS.length)], mode: MODES[f.room < 0 ? 0 : Math.floor(r() * MODES.length)] };
    }
  }

  private noteOf(deg: number, octave: number) {
    const m = this.mode;
    const n = m.length;
    const o = Math.floor(deg / n);
    const d = ((deg % n) + n) % n;
    return this.root + m[d] + 12 * (o + octave);
  }

  private applyKey(t: number) {
    if (!this.pendingKey) return;
    this.root = this.pendingKey.root;
    this.mode = this.pendingKey.mode;
    this.pendingKey = null;
    const iv = [0, 7, 12, 19];
    this.droneOsc.forEach((o, i) => o.frequency.setTargetAtTime(mtof(this.root - 12 + iv[i]), t, 2.5));
  }

  private schedule() {
    const ctx = this.ctx!;
    // smooth intensity: rise ~5s, fall ~9s
    const target = this.field.intensity;
    const tc = target > this.I ? 5 : 9;
    this.I += (target - this.I) * (1 - Math.exp(-0.06 / tc));
    const I = this.I;
    const now = ctx.currentTime;
    // continuous params
    this.droneFilter.frequency.setTargetAtTime(220 + 1400 * Math.pow(I, 1.4) + this.field.level * 60, now, 0.5);
    this.droneGain.gain.setTargetAtTime(0.11 + 0.05 * I, now, 0.8);

    const bpm = 56 + 34 * I;
    const stepDur = 60 / bpm / 4; // 16ths
    this.dly.delayTime.setTargetAtTime(stepDur * 3, now, 0.5);
    while (this.nextStep < now + 0.25) {
      this.tick(this.nextStep, this.step, stepDur, I);
      this.nextStep += stepDur * (this.step % 2 ? 0.92 : 1.08); // gentle swing
      this.step++;
    }
  }

  private tick(t: number, step: number, sd: number, I: number) {
    const r = this.r;
    const bar = step % 16;
    if (step % 64 === 0) this.applyKey(t);
    // chord change every 2 bars
    if (step % 32 === 0) {
      const roots = [0, 3, 4, 1, 5, 2];
      const base = roots[Math.floor(r() * roots.length)];
      this.chord = [base, base + 2, base + 4];
      // pad: always when people are around, sometimes when alone
      if (r() < 0.35 + I * 0.65) this.pad(t, sd * 32, 0.05 + I * 0.04);
    }
    // bells
    const pBell = 0.025 + I * 0.16;
    if (r() < pBell) {
      this.melodyIdx += Math.floor(r() * 5) - 2;
      this.melodyIdx = Math.max(-2, Math.min(9, this.melodyIdx));
      this.bell(t, mtof(this.noteOf(this.melodyIdx, 1)), 0.06 + r() * 0.04, 0, 2.5 + r() * 2);
    }
    // arpeggio
    if (I > 0.32 && step % 2 === 0) {
      const amt = (I - 0.32) / 0.68;
      if (r() < 0.55 + amt * 0.4) {
        const pattern = [0, 1, 2, 1, 2, 3, 2, 1];
        const ci = pattern[(step / 2) % 8];
        const deg = this.chord[ci % 3] + (ci === 3 ? this.mode.length : 0);
        this.pluck(t, mtof(this.noteOf(deg, 0)), 0.035 * amt + 0.01, sd * 3);
      }
    }
    // pulse
    if (I > 0.58) {
      const amt = (I - 0.58) / 0.42;
      if (bar === 0 || bar === 8) this.kick(t, 0.22 * amt);
      if (I > 0.72 && bar % 4 === 2 && r() < 0.8) this.shaker(t, 0.03 * amt);
    }
    // personal tones of nearby players
    if (step % 4 === 0) {
      for (const v of this.field.voices) {
        const p = (v.moving ? 0.22 : 0.05) * v.gain;
        if (r() < p) {
          const deg = v.tone % (this.mode.length * 2);
          this.bell(t + r() * sd, mtof(this.noteOf(deg, 1 + (v.tone % 3 === 0 ? 1 : 0))), 0.07 * v.gain + 0.015, v.pan, 3);
        }
      }
    }
  }

  private out(pan: number, rev: number, dly = 0) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(this.dry);
    if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; p.connect(s).connect(this.revIn); }
    if (dly > 0) { const s = ctx.createGain(); s.gain.value = dly; p.connect(s).connect(this.dlyIn); }
    return g;
  }

  private bell(t: number, f: number, vol: number, pan: number, dur: number) {
    const ctx = this.ctx!;
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * (this.r() < 0.5 ? 3.5 : 2.01);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.01, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    const env = this.out(pan, 0.7, 0.25);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(env);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }

  private pluck(t: number, f: number, vol: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur);
    const env = this.out((this.r() - 0.5) * 0.8, 0.35, 0.45);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    o.connect(lp).connect(env);
    o.start(t); o.stop(t + dur + 0.5);
  }

  private pad(t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    for (const [i, deg] of this.chord.entries()) {
      const f = mtof(this.noteOf(deg, 0));
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + this.I * 900; lp.Q.value = 0.3;
        const env = this.out((i - 1) * 0.5 + det / 30, 0.8);
        const a = Math.min(3, dur * 0.3);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(vol / 3, t + a);
        env.gain.setValueAtTime(vol / 3, t + dur - a);
        env.gain.linearRampToValueAtTime(0, t + dur + 1.5);
        o.connect(lp).connect(env);
        o.start(t); o.stop(t + dur + 1.6);
      }
    }
  }

  private kick(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    const env = this.out(0, 0.1);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(env); o.start(t); o.stop(t + 0.65);
  }

  private shaker(t: number, vol: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const env = this.out((this.r() - 0.5) * 0.6, 0.3);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(hp).connect(env);
    s.start(t, this.r() * 1.5, 0.12);
  }

  /** soft chime for joins / leaves (works only when enabled) */
  event(kind: 'join' | 'leave' | 'bounce' | 'door') {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    if (kind === 'join') [0, 2, 4].forEach((d, i) => this.bell(t + i * 0.12, mtof(this.noteOf(d + 5, 1)), 0.045, 0, 3));
    else if (kind === 'leave') [4, 2, 0].forEach((d, i) => this.bell(t + i * 0.16, mtof(this.noteOf(d, 1)), 0.035, 0, 3));
    else if (kind === 'bounce') this.pluck(t, mtof(this.noteOf(7 + Math.floor(this.r() * 3), 0)), 0.06, 0.4);
    else if (kind === 'door') this.kick(t, 0.05);
  }

  /** read frequency data for the visualizer, returns null when not playing */
  spectrum(buf: Uint8Array<ArrayBuffer>) {
    if (!this.enabled || !this.ctx) return null;
    this.analyser.getByteFrequencyData(buf);
    return buf;
  }
  get level() { return this.I; }
}
