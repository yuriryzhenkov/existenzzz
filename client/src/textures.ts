import * as THREE from 'three';

// Tiny procedural pixel-art textures (16x16), nearest filtered, repeating per metre.

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeTex(draw: (ctx: CanvasRenderingContext2D, r: () => number) => void, seed: number, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

const px = (ctx: CanvasRenderingContext2D, x: number, y: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
const shade = (base: [number, number, number], k: number) => `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;

type RGB = [number, number, number];
const fill = (ctx: CanvasRenderingContext2D, r: () => number, base: RGB, lo: number, span: number, w = 16, h = 16) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(ctx, x, y, shade(base, lo + r() * span));
};

// ---- EXISTENZZZ tissues (see docs/CONCEPT.md). Same roles as a building, grown by an organism. ----

/** BONE (the frame: slabs, bands, sills, lintels): ivory, porous like trabecular bone */
export function boneTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [214, 204, 182];
    fill(ctx, r, base, 0.9, 0.12);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      px(ctx, x, y, shade(base, 0.62)); if (r() < 0.5) px(ctx, (x + 1) & 15, y, shade(base, 0.72));
    }
    for (let x = 0; x < 16; x++) if (r() < 0.6) px(ctx, x, 7, shade(base, 0.86)); // growth line
  }, 201);
}

/** MEMBRANE (interior walls = the canvas): pale translucent skin with faint capillaries */
export function membraneTex() {
  return makeTex((ctx, r) => {
    // a calm canvas: almost flat, only a faint grain, so paint reads clearly on it
    const base: RGB = [214, 204, 212];
    fill(ctx, r, base, 0.97, 0.03);
  }, 202);
}

/** SCALES (outer skin / facade): dark iridescent scales with vertical tendons to climb on */
export function scalesTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [58, 64, 82];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / 4), off = row % 2 ? 2 : 0;
      const lx = (x + off) % 4, ly = y % 4;
      const edge = ly === 3 || (ly === 2 && (lx === 0 || lx === 3));
      px(ctx, x, y, shade(base, edge ? 0.6 : 0.95 + (3 - ly) * 0.06 + r() * 0.06));
    }
    for (let y = 0; y < 16; y++) { px(ctx, 7, y, shade([150, 92, 96], 0.9 + r() * 0.15)); if (r() < 0.5) px(ctx, 8, y, shade([150, 92, 96], 0.75)); } // tendon
  }, 203);
}

/** NACRE (ground floor): mother-of-pearl, soft bands; iridescence is added in the shader */
export function nacreTex() {
  return makeTex((ctx, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = Math.sin((x + y * 0.6) * 0.8 + r() * 0.3) * 0.5 + 0.5;
      px(ctx, x, y, shade([196 + band * 20, 200, 214 - band * 12] as RGB, 0.9 + r() * 0.06));
    }
  }, 204);
}

/** FELT (upper floors): dense hyphal felt, amber fibres crossing */
export function feltTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [150, 112, 70];
    fill(ctx, r, base, 0.8, 0.12);
    for (let i = 0; i < 10; i++) {
      let x = r() * 16, y = r() * 16; const a = r() * Math.PI;
      for (let k = 0; k < 6; k++) { px(ctx, Math.floor(x) & 15, Math.floor(y) & 15, shade([206, 160, 96], 0.85 + r() * 0.2)); x += Math.cos(a); y += Math.sin(a); }
    }
  }, 205);
}

/** CARTILAGE (stair treads on the vertebrae, handrail caps): translucent blue-white */
export function cartilageTex() {
  return makeTex((ctx, r) => {
    fill(ctx, r, [196, 214, 222], 0.9, 0.1);
    for (let x = 0; x < 16; x++) px(ctx, x, (x * 3) % 16, shade([170, 196, 210], 0.9));
  }, 206);
}

/** SINEW (handrails, door lips): red-brown striated fibre */
export function sinewTex() {
  return makeTex((ctx, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade([150, 70, 72], 0.75 + ((y + Math.floor(r() * 2)) % 3) * 0.1 + r() * 0.05));
  }, 207);
}

/** ROE (roof): dark bed of translucent spore-eggs */
export function roeTex() {
  return makeTex((ctx, r) => {
    fill(ctx, r, [40, 36, 52], 0.85, 0.2);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
      ctx.fillStyle = shade([150, 120, 190], 0.8 + r() * 0.3); ctx.fillRect(x, y, 2, 2);
      px(ctx, x, y, '#e8dcff');
    }
  }, 208);
}

/** LIVING SOIL (atrium, where the organism roots) */
export function soilTex() {
  return makeTex((ctx, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(r() < 0.4 ? [56, 72, 70] : [62, 46, 52], 0.8 + r() * 0.3));
    for (let i = 0; i < 4; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), '#9fe8d0');
  }, 209);
}

/** MOSS-FLESH (island surface under the cilia) */
export function mossTex() {
  return makeTex((ctx, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(r() < 0.5 ? [40, 70, 66] : [52, 58, 74], 0.75 + r() * 0.3));
  }, 210);
}

/** Exposed tissue at wounds and floor holes: raw, glossy red under the bone */
export function woundTex() {
  return makeTex((ctx, r) => {
    fill(ctx, r, [150, 52, 66], 0.8, 0.25);
    for (let i = 0; i < 6; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), '#f0b0b8');
  }, 211);
}

/** door lips: two halves of membrane flesh */
export function lipTex() {
  return makeTex((ctx, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade([170, 96, 112], 0.8 + Math.sin(y * 0.9) * 0.08 + r() * 0.08));
  }, 212);
}

export function capTex(base: [number, number, number], spot = '#fff4e6', seed = 51) {
  return makeTex((ctx, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.88 + r() * 0.16));
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(r() * 14), y = Math.floor(r() * 14);
      ctx.fillStyle = spot; ctx.fillRect(x, y, 2, 2);
    }
  }, seed);
}

export function stemTex() {
  return makeTex((ctx, r) => {
    const base: [number, number, number] = [236, 224, 204];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.86 + ((x + Math.floor(r() * 3)) % 4) * 0.04));
  }, 61);
}

export function gillTex() {
  return makeTex((ctx, r) => {
    const base: [number, number, number] = [214, 180, 168];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, x % 2 ? 0.8 : 0.95 + r() * 0.05));
  }, 71);
}

/** Generated pixel "mushroom face" avatar for guests / users without photo */
export function mushroomFace(seed: string): HTMLCanvasElement {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(h);
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d')!;
  const hue = Math.floor(r() * 360);
  ctx.fillStyle = `hsl(${hue},55%,62%)`;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = `hsl(${hue},45%,82%)`;
  for (let i = 0; i < 4; i++) ctx.fillRect(Math.floor(r() * 7), Math.floor(r() * 3), 1, 1);
  ctx.fillStyle = '#f3e3cf';
  ctx.fillRect(1, 3, 6, 5);
  ctx.fillStyle = '#2a1f2e';
  const eyeY = 4 + Math.floor(r() * 2);
  ctx.fillRect(2, eyeY, 1, 1); ctx.fillRect(5, eyeY, 1, 1);
  const mouth = Math.floor(r() * 3);
  if (mouth === 0) ctx.fillRect(3, 6, 2, 1);
  else if (mouth === 1) { ctx.fillRect(3, 7, 2, 1); px(ctx, 2, 6, '#2a1f2e'); px(ctx, 5, 6, '#2a1f2e'); }
  else ctx.fillRect(4, 6, 1, 1);
  ctx.fillStyle = `hsla(${(hue + 180) % 360},70%,70%,0.6)`;
  ctx.fillRect(1, eyeY + 1, 1, 1); ctx.fillRect(6, eyeY + 1, 1, 1);
  return c;
}
