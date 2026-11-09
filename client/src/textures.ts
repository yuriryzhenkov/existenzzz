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

/** Monolithic concrete: formwork board joints every 25cm + tie holes */
export function concreteTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [158, 156, 152];
    fill(ctx, r, base, 0.9, 0.12);
    for (let x = 0; x < 16; x++) { px(ctx, x, 0, shade(base, 0.84)); px(ctx, x, 8, shade(base, 0.86)); }
    px(ctx, 4, 4, shade(base, 0.55)); px(ctx, 12, 12, shade(base, 0.55));
    for (let i = 0; i < 3; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), shade(base, 0.78));
  }, 101);
}

/** Lime plaster: near-white, very subtle trowel unevenness — the canvas */
export function plasterTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [236, 232, 224];
    fill(ctx, r, base, 0.965, 0.045);
    for (let i = 0; i < 4; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), shade(base, 0.93));
  }, 102);
}

/** Red brick, 25x6.5cm bricks with mortar (approximated to the 16px/m grid) */
export function brickTex() {
  return makeTex((ctx, r) => {
    const brick: RGB = [150, 68, 52], mortar: RGB = [196, 186, 170];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / 2);
      const off = row % 2 ? 2 : 0;
      const isMortarH = y % 2 === 1;
      const isMortarV = (x + off) % 4 === 3;
      px(ctx, x, y, isMortarH || isMortarV ? shade(mortar, 0.92 + r() * 0.08) : shade(brick, 0.85 + r() * 0.2));
    }
  }, 103);
}

/** Polished concrete screed (ground floor): lighter, with aggregate specks */
export function screedTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [176, 172, 166];
    fill(ctx, r, base, 0.94, 0.08);
    for (let i = 0; i < 10; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), shade(base, r() < 0.5 ? 0.8 : 1.1));
    for (let x = 0; x < 16; x++) px(ctx, x, 15, shade(base, 0.86)); // expansion joint every metre
  }, 104);
}

/** Oak plank parquet: 4 planks per metre, staggered butt joints */
export function oakTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [168, 122, 78];
    for (let y = 0; y < 16; y++) {
      const plank = Math.floor(y / 4);
      const tone = 0.88 + ((plank * 7) % 3) * 0.05;
      for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, tone + (y % 4 === 1 && r() < 0.3 ? -0.06 : 0) + r() * 0.05));
      if (y % 4 === 3) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.66));
    }
    for (let p = 0; p < 4; p++) { const x = (p * 5 + 3) % 16; for (let y = p * 4; y < p * 4 + 3; y++) px(ctx, x, y, shade(base, 0.68)); }
  }, 105);
}

/** Solid oak for handrails, treads, door leaves: long grain */
export function woodTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [150, 104, 64];
    for (let y = 0; y < 16; y++) {
      const g = 0.86 + Math.sin(y * 1.7 + r()) * 0.06;
      for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, g + r() * 0.04));
    }
  }, 106);
}

/** Soil with moss — where the mycelium came up through the floor */
export function soilTex() {
  return makeTex((ctx, r) => {
    const soil: RGB = [92, 70, 52], moss: RGB = [88, 112, 64];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const m = r() < 0.45;
      px(ctx, x, y, shade(m ? moss : soil, 0.82 + r() * 0.25));
    }
    for (let i = 0; i < 4; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), '#e8e2d4'); // mycelium threads
  }, 107);
}

/** Bitumen roofing with gravel */
export function roofTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [84, 82, 86];
    fill(ctx, r, base, 0.85, 0.2);
    for (let i = 0; i < 18; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), shade([150, 144, 136], 0.8 + r() * 0.3));
  }, 108);
}

/** Concrete eaten by mycelium: grey with sparse, irregular whitish hyphae (low contrast, no motif) */
export function myceliumTex() {
  const t = makeTex((ctx, r) => {
    const base: RGB = [150, 148, 144];
    fill(ctx, r, base, 0.86, 0.14, 32, 32);
    for (let t = 0; t < 7; t++) {
      let x = r() * 32, y = r() * 32, a = r() * Math.PI * 2;
      const len = 4 + r() * 10;
      for (let i = 0; i < len; i++) {
        px(ctx, Math.floor(x) & 31, Math.floor(y) & 31, shade([226, 222, 212], 0.9 + r() * 0.12));
        a += (r() - 0.5) * 1.2; x += Math.cos(a); y += Math.sin(a);
      }
    }
  }, 109, 32);
  t.repeat.set(0.5, 0.5); // 32px over 2m keeps the world-wide 16px/m pixel density
  return t;
}

export function grassTex() {
  return makeTex((ctx, r) => {
    const base: RGB = [92, 124, 76];
    fill(ctx, r, base, 0.82, 0.3);
    for (let i = 0; i < 6; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), shade([120, 156, 90], 0.9 + r() * 0.2));
  }, 21);
}

/** Plain oak door leaf: stiles, rails and a recessed panel, brass handle */
export function doorTex() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 48;
  const ctx = c.getContext('2d')!;
  const r = rng(41);
  const base: RGB = [140, 98, 60];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) px(ctx, x, y, shade(base, 0.88 + Math.sin(x * 1.3) * 0.03 + r() * 0.05));
  ctx.strokeStyle = shade(base, 0.68);
  ctx.lineWidth = 1;
  ctx.strokeRect(5.5, 5.5, 21, 16);
  ctx.strokeRect(5.5, 26.5, 21, 16);
  ctx.fillStyle = '#c9a24a'; ctx.fillRect(27, 23, 2, 3);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
