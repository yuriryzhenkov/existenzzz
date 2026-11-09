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

export function stoneTex() {
  return makeTex((ctx, r) => {
    const base: [number, number, number] = [214, 206, 222];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.9 + r() * 0.14));
    // brick seams
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.8));
    for (let y = 0; y < 16; y++) {
      const off = Math.floor(y / 4) % 2 ? 0 : 8;
      px(ctx, (off + 3) % 16, y, shade(base, 0.82));
      px(ctx, (off + 11) % 16, y, shade(base, 0.82));
    }
  }, 7);
}

export function floorTex() {
  return makeTex((ctx, r) => {
    const base: [number, number, number] = [150, 112, 92];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.9 + r() * 0.15));
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.72));
    for (let i = 0; i < 4; i++) px(ctx, Math.floor(r() * 16), i * 4 + 1 + Math.floor(r() * 2), shade(base, 0.7));
  }, 11);
}

export function grassTex() {
  return makeTex((ctx, r) => {
    const base: [number, number, number] = [96, 132, 104];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.82 + r() * 0.3));
    for (let i = 0; i < 3; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), i ? '#d8c8f0' : '#f4e08a');
  }, 21);
}

export function woodTex() {
  return makeTex((ctx, r) => {
    const base: [number, number, number] = [176, 128, 90];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, x, y, shade(base, 0.85 + ((x * 3 + Math.floor(r() * 2)) % 5) * 0.04));
    for (let x = 0; x < 16; x += 5) for (let y = 0; y < 16; y++) px(ctx, x, y, shade(base, 0.68));
  }, 31);
}

export function doorTex() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 48;
  const ctx = c.getContext('2d')!;
  const r = rng(41);
  const base: [number, number, number] = [130, 86, 120];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) px(ctx, x, y, shade(base, 0.85 + ((x >> 2) % 2) * 0.08 + r() * 0.06));
  ctx.fillStyle = shade(base, 0.6);
  ctx.fillRect(0, 0, 32, 2); ctx.fillRect(0, 46, 32, 2); ctx.fillRect(0, 0, 2, 48); ctx.fillRect(30, 0, 2, 48);
  // little mushroom emblem
  ctx.fillStyle = '#e8d8c0'; ctx.fillRect(14, 20, 4, 8);
  ctx.fillStyle = '#d0504a'; ctx.fillRect(10, 14, 12, 6); ctx.fillRect(12, 12, 8, 2);
  ctx.fillStyle = '#fff'; px(ctx, 13, 15, '#fff'); px(ctx, 18, 16, '#fff'); px(ctx, 15, 13, '#fff');
  ctx.fillStyle = '#f2c94c'; ctx.fillRect(25, 24, 2, 3);
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
