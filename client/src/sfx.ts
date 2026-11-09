// Footsteps, synthesized (no samples): every surface sounds like its material in docs/MATERIALS.md.
// Soft by design: low-passed, short, randomized per step so it never sounds like a machine gun.
import { FLOOR_H, LEVELS, STATIC_BOXES, SIZE, cellAt, isStair } from '../../shared/world';

export type Surface = 'concrete' | 'oak' | 'stairs' | 'soil' | 'grass' | 'gravel' | 'mushroom';

const inAtrium = (x: number, z: number) => x >= 15 && x <= 25 && z >= 15 && z <= 25;

/** what is under the feet at (x, y, z) — y is the feet height */
export function surfaceAt(x: number, y: number, z: number): Surface {
  for (const b of STATIC_BOXES) {
    if (Math.abs(b.y1 - y) < 0.08 && x >= b.x0 - 0.3 && x <= b.x1 + 0.3 && z >= b.z0 - 0.3 && z <= b.z1 + 0.3) return 'mushroom';
  }
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix < 0 || iz < 0 || ix >= SIZE || iz >= SIZE) return 'grass';
  const L = Math.max(0, Math.min(LEVELS - 1, Math.floor((y + 0.1) / FLOOR_H)));
  const c = cellAt(L, ix, iz);
  const onSlab = Math.abs(y - L * FLOOR_H) < 0.08;
  if (c === 'b' || c === 'B') return 'mushroom';
  if (isStair(c) && !onSlab) return 'stairs';
  if (c === 'r') return L === LEVELS - 1 && (ix === 0 || iz === 0 || ix === SIZE - 1 || iz === SIZE - 1) ? 'concrete' : 'oak'; // parapet top / oak handrail
  if (c === '#' || c === 'w' || c === 'D') return 'concrete';
  if (L === LEVELS - 1) return 'gravel';
  if (L === 0) return inAtrium(ix, iz) ? 'soil' : 'concrete';
  return 'oak';
}

const INDOOR_REVERB: Record<Surface, number> = { concrete: 0.35, oak: 0.22, stairs: 0.25, soil: 0.12, grass: 0, gravel: 0.02, mushroom: 0.08 };

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
    const v = 0.9 + r() * 0.2; // per-step variation
    const heavy = weight > 1;

    switch (surface) {
      case 'concrete': // short, dry heel tap; the hall answers with a little echo
        burst(1700 * v, 1.1, 'bandpass', 0.05, 0.22);
        thump(140 * v, 70, heavy ? 0.12 : 0.07, heavy ? 0.35 : 0.18);
        break;
      case 'oak': // hollow wooden knock; old parquet sometimes creaks
        burst(850 * v, 1.6, 'bandpass', 0.07, 0.2);
        thump(190 * v, 110, heavy ? 0.14 : 0.09, heavy ? 0.4 : 0.22);
        if (r() < 0.07) {
          const o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.setValueAtTime(420 + r() * 120, t + 0.03);
          o.frequency.linearRampToValueAtTime(340 + r() * 60, t + 0.25);
          const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 6;
          const e = ctx.createGain();
          e.gain.setValueAtTime(0, t + 0.03); e.gain.linearRampToValueAtTime(0.03, t + 0.08); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          o.connect(f).connect(e).connect(g); o.start(t + 0.03); o.stop(t + 0.3);
        }
        break;
      case 'stairs': // oak treads: like parquet, a bit brighter (smaller, thinner boards)
        burst(1150 * v, 1.8, 'bandpass', 0.06, 0.2);
        thump(240 * v, 140, 0.08, 0.2);
        break;
      case 'soil': // muffled, soft: moss swallows the high end
        burst(420 * v, 0.7, 'lowpass', 0.13, 0.32, t, 0.012);
        thump(90, 55, heavy ? 0.16 : 0.1, heavy ? 0.3 : 0.12);
        break;
      case 'grass': // swish of blades + soft ground
        burst(3800 * v, 0.8, 'bandpass', 0.16, 0.09, t, 0.02);
        burst(500, 0.7, 'lowpass', 0.1, 0.18, t, 0.01);
        break;
      case 'gravel': // crunch: many tiny stones shifting
        for (let i = 0; i < 7; i++) burst(2400 + r() * 2200, 2, 'bandpass', 0.025, 0.12 + r() * 0.08, t + r() * 0.07);
        thump(110, 60, 0.07, 0.12);
        break;
      case 'mushroom': // springy, squishy flesh
        thump(230 * v, 120, 0.16, heavy ? 0.3 : 0.16);
        burst(600 * v, 1.2, 'lowpass', 0.12, 0.15, t, 0.015);
        break;
    }
  }
}
