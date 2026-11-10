// Footsteps, synthesized (no samples). Same logic as before — every floor sounds like what it is made of —
// but the materials are alien tissue now (docs/CONCEPT.md): glassy nacre, fibrous felt, bony vertebrae,
// wet soil, brushing cilia, popping roe. Soft by design: low-passed, short, randomized per step.
import { FLOOR_H, LEVELS, STATIC_BOXES, SIZE, cellAt, isStair } from '../../shared/world';

export type Surface = 'nacre' | 'felt' | 'vertebra' | 'soil' | 'cilia' | 'roe' | 'flesh' | 'bone' | 'sinew' | 'scales' | 'membrane';

const inAtrium = (x: number, z: number) => x >= 15 && x <= 25 && z >= 15 && z <= 25;

/** what is under the feet at (x, y, z) — y is the feet height */
export function surfaceAt(x: number, y: number, z: number): Surface {
  for (const b of STATIC_BOXES) {
    if (Math.abs(b.y1 - y) < 0.08 && x >= b.x0 - 0.3 && x <= b.x1 + 0.3 && z >= b.z0 - 0.3 && z <= b.z1 + 0.3) return 'flesh';
  }
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix < 0 || iz < 0 || ix >= SIZE || iz >= SIZE) return y > 0.5 ? 'scales' : 'cilia';
  const L = Math.max(0, Math.min(LEVELS - 1, Math.floor((y + 0.1) / FLOOR_H)));
  const c = cellAt(L, ix, iz);
  const onSlab = Math.abs(y - L * FLOOR_H) < 0.08;
  const edge = ix === 0 || iz === 0 || ix === SIZE - 1 || iz === SIZE - 1;
  if (c === 'b' || c === 'B') return 'flesh';
  if (isStair(c) && !onSlab) return 'vertebra';
  if (c === 'r' && !onSlab) return L === LEVELS - 1 && edge ? 'scales' : 'sinew';
  if ((c === '#' || c === 'w' || c === 'D') && !onSlab) return edge ? 'scales' : 'bone';
  if (L === LEVELS - 1) return 'roe';
  if (L === 0) return inAtrium(ix, iz) ? 'soil' : 'nacre';
  return 'felt';
}

const INDOOR_REVERB: Record<Surface, number> = { nacre: 0.38, felt: 0.18, vertebra: 0.28, soil: 0.12, cilia: 0, roe: 0.04, flesh: 0.1, bone: 0.3, sinew: 0.2, scales: 0.06, membrane: 0.25 };

export class Sfx {
  ctx: AudioContext | null = null;
  private out!: GainNode;
  private rev!: GainNode;
  private noise!: AudioBuffer;
  enabled = true;
  private side = 1;

  /** must be called from a user gesture */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = this.enabled ? 0.55 : 0;
      this.out.connect(ctx.destination);
      // small-room reverb for indoor surfaces (0.7s generated impulse)
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 0.7);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      conv.buffer = ir;
      this.rev = ctx.createGain();
      this.rev.connect(conv).connect(this.out);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.out.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  /** gain 0..1 (distance/crouch), pan -1..1, weight: 1 step, 1.8 landing */
  step(surface: Surface, gain = 1, pan = 0, weight = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running' || gain < 0.02) return;
    const t = ctx.currentTime + 0.005;
    const r = () => Math.random();
    this.side = -this.side;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan + this.side * 0.08));
    const g = ctx.createGain();
    g.gain.value = gain * (0.85 + r() * 0.3) * (weight > 1 ? 1.4 : 1);
    g.connect(p).connect(this.out);
    const send = ctx.createGain();
    send.gain.value = INDOOR_REVERB[surface];
    p.connect(send).connect(this.rev);

    // building blocks
    const burst = (f: number, q: number, type: BiquadFilterType, dur: number, vol: number, at = t, attack = 0.002) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const flt = ctx.createBiquadFilter();
      flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(vol, at + attack);
      e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      s.connect(flt).connect(e).connect(g);
      s.start(at, r() * 0.8, dur + 0.05);
    };
    const thump = (f0: number, f1: number, dur: number, vol: number, at = t) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(vol, at + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(e).connect(g);
      o.start(at); o.stop(at + dur + 0.02);
    };
    const bell = (f: number, dur: number, vol: number, at = t) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(vol, at + 0.003); e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(e).connect(g); o.start(at); o.stop(at + dur + 0.02);
    };
    const creak = (at: number, vol: number) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(380 + r() * 120, at);
      o.frequency.linearRampToValueAtTime(300 + r() * 60, at + 0.18);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 6;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(vol, at + 0.04); e.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(f).connect(e).connect(g); o.start(at); o.stop(at + 0.22);
    };
    const v = 0.9 + r() * 0.2; // per-step variation
    const heavy = weight > 1;

    switch (surface) {
      case 'nacre': // glassy tick of mother-of-pearl + a faint ringing overtone; the hall answers
        burst(3200 * v, 3, 'bandpass', 0.04, 0.16);
        thump(150 * v, 80, heavy ? 0.12 : 0.07, heavy ? 0.32 : 0.16);
        bell(1900 * v + r() * 400, 0.35, 0.025);
        break;
      case 'felt': // hyphal felt: a fibrous, muffled thud with a dry rustle
        burst(700 * v, 0.9, 'lowpass', 0.1, 0.26, t, 0.008);
        burst(2600 * v, 1.2, 'bandpass', 0.06, 0.05, t + 0.01, 0.01);
        thump(120 * v, 70, heavy ? 0.14 : 0.09, heavy ? 0.34 : 0.18);
        break;
      case 'vertebra': // bone over cartilage: hollow knock, then a soft give
        burst(1300 * v, 2.2, 'bandpass', 0.05, 0.2);
        thump(260 * v, 150, 0.07, 0.22);
        thump(110, 70, 0.1, 0.1, t + 0.03);
        break;
      case 'bone': // walking on wall tops: dry, bright knock
        burst(1800 * v, 2.5, 'bandpass', 0.04, 0.2);
        thump(300 * v, 180, 0.05, 0.18);
        break;
      case 'soil': // living soil: wet, soft squelch
        burst(380 * v, 0.7, 'lowpass', 0.15, 0.32, t, 0.014);
        burst(900 * v, 4, 'bandpass', 0.09, 0.08, t + 0.04, 0.02);
        thump(85, 50, heavy ? 0.16 : 0.1, heavy ? 0.3 : 0.12);
        break;
      case 'cilia': // the cilia brush away from the foot: airy swish over soft ground
        burst(4200 * v, 0.9, 'bandpass', 0.2, 0.08, t, 0.03);
        burst(1800 * v, 1.5, 'bandpass', 0.14, 0.05, t + 0.03, 0.03);
        burst(480, 0.7, 'lowpass', 0.1, 0.16, t, 0.01);
        break;
      case 'roe': // the roof is roe: a cluster of tiny wet pops
        for (let i = 0; i < 5; i++) thump(700 + r() * 600, 300, 0.03, 0.05 + r() * 0.05, t + r() * 0.06);
        burst(500, 0.8, 'lowpass', 0.08, 0.14, t, 0.01);
        break;
      case 'flesh': // mushroom flesh: springy squish
        thump(230 * v, 120, 0.16, heavy ? 0.3 : 0.16);
        burst(600 * v, 1.2, 'lowpass', 0.12, 0.15, t, 0.015);
        break;
      case 'sinew': // handrail sinew: a short taut creak
        creak(t, 0.025);
        thump(160, 100, 0.06, 0.12);
        break;
      case 'scales': // dark scales of the facade: small hard clicks
        for (let i = 0; i < 3; i++) burst(2600 + r() * 1500, 4, 'bandpass', 0.02, 0.12, t + i * 0.012);
        thump(140, 80, 0.06, 0.14);
        break;
      case 'membrane':
        burst(500 * v, 1, 'lowpass', 0.1, 0.2, t, 0.01);
        break;
    }
  }

  /** a one-shot built from a few envelopes (shared by the non-step sounds) */
  private voice(gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return null;
    const g = ctx.createGain(); g.gain.value = gain; g.connect(this.out);
    const send = ctx.createGain(); send.gain.value = 0.25; g.connect(send).connect(this.rev);
    const t = ctx.currentTime + 0.005;
    const noise = (f: number, q: number, type: BiquadFilterType, at: number, dur: number, vol: number, attack = 0.003, f1?: number) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, at); flt.Q.value = q;
      if (f1) flt.frequency.exponentialRampToValueAtTime(f1, at + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(vol, at + attack); e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      s.connect(flt).connect(e).connect(g); s.start(at, Math.random() * 0.5, dur + 0.05);
    };
    const tone = (f0: number, f1: number, at: number, dur: number, vol: number, type: OscillatorType = 'sine', attack = 0.004) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(vol, at + attack); e.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(e).connect(g); o.start(at); o.stop(at + dur + 0.02);
    };
    return { t, noise, tone };
  }

  /** the pickaxe bites tissue: wet thock on membranes, glassy chip on nacre, fibrous on felt */
  pick(surface: Surface) {
    const v = this.voice(0.7); if (!v) return;
    const { t, noise, tone } = v;
    if (surface === 'nacre' || surface === 'bone' || surface === 'scales') { noise(3500, 3, 'bandpass', t, 0.05, 0.3); tone(900, 500, t, 0.08, 0.12, 'triangle'); }
    else if (surface === 'felt') { noise(900, 1, 'lowpass', t, 0.1, 0.35); tone(140, 80, t, 0.08, 0.2); }
    else if (surface === 'roe') { for (let i = 0; i < 4; i++) tone(800 + Math.random() * 500, 300, t + i * 0.015, 0.03, 0.1); }
    else { noise(700, 1.2, 'lowpass', t, 0.12, 0.4, 0.002, 300); tone(180, 90, t, 0.1, 0.25); }
  }

  /** tissue tears open */
  tear(gain = 1) {
    const v = this.voice(0.8 * gain); if (!v) return;
    const { t, noise, tone } = v;
    noise(2400, 0.8, 'bandpass', t, 0.35, 0.35, 0.01, 400);
    noise(300, 0.7, 'lowpass', t + 0.05, 0.3, 0.3, 0.02);
    tone(90, 40, t, 0.35, 0.3);
  }

  /** a wound closes: a soft rising inhale */
  heal() {
    const v = this.voice(0.5); if (!v) return;
    const { t, noise, tone } = v;
    noise(300, 1, 'bandpass', t, 1.1, 0.22, 0.6, 1800);
    tone(220, 440, t + 0.2, 0.9, 0.05, 'sine', 0.5);
  }

  /** a tendon creaks under the hand */
  climb() {
    const v = this.voice(0.5); if (!v) return;
    const { t, noise, tone } = v;
    tone(420 + Math.random() * 120, 300, t, 0.16, 0.05, 'sawtooth', 0.03);
    noise(1200, 2, 'bandpass', t, 0.08, 0.12);
  }

  /** falling into the void: wind rising, then nothing */
  fall() {
    const v = this.voice(0.9); if (!v) return;
    const { t, noise, tone } = v;
    noise(300, 0.6, 'bandpass', t, 6, 0.5, 3, 3200);
    tone(120, 28, t, 6, 0.25, 'sine', 1);
  }
}
