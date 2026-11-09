import * as THREE from 'three';
import { PANELS, PANEL_BY_ID, type Panel } from '../../shared/world';
import type { StrokeData } from '../../shared/protocol';

export const PX_PER_M = 40;
const PX_PER_CM = PX_PER_M / 100;

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const css = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface PanelView {
  panel: Panel;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  dirty: boolean;
}

/** Draw segment i of a stroke (cm coords in panel space) */
export function drawSegment(ctx: CanvasRenderingContext2D, panelH: number, tool: number, color: number, size: number, seed: number, i: number, u0: number, v0: number, u1: number, v1: number) {
  const H = panelH * PX_PER_M;
  const x0 = u0 * PX_PER_CM, y0 = H - v0 * PX_PER_CM, x1 = u1 * PX_PER_CM, y1 = H - v1 * PX_PER_CM;
  const w = Math.max(1, size * PX_PER_CM);
  const col = css(color);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  switch (tool) {
    case 0: { // brush: round
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
      if (x0 === x1 && y0 === y1) { ctx.beginPath(); ctx.arc(x0, y0, w / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      break;
    }
    case 1: { // marker: flat chisel tip, slightly translucent
      ctx.fillStyle = col; ctx.globalAlpha = 0.55;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, w * 0.15)));
      for (let k = 0; k <= n; k++) {
        if (k === 0 && i > 0) continue; // avoid double-darkening joints
        const t = k / n;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        ctx.fillRect(x - w / 2, y - w / 6, w, w / 3);
      }
      break;
    }
    case 2: { // spray
      const r = rng(seed * 7919 + i * 104729);
      ctx.fillStyle = col;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const dots = Math.min(400, Math.ceil(10 + (len / Math.max(1, w)) * 26 + w * 0.8));
      for (let k = 0; k < dots; k++) {
        const t = r();
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w * 0.5 * (0.4 + r() * 0.6);
        const s = r() < 0.15 ? 2 : 1;
        ctx.globalAlpha = 0.5 + r() * 0.5;
        ctx.fillRect(Math.round(x0 + (x1 - x0) * t + Math.cos(a) * d), Math.round(y0 + (y1 - y0) * t + Math.sin(a) * d), s, s);
      }
      break;
    }
    case 3: { // pixel: snaps to a grid of `size`
      ctx.fillStyle = col;
      const g = w;
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (g * 0.5)));
      let last = '';
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const gx = Math.floor((x0 + (x1 - x0) * t) / g), gy = Math.floor((y0 + (y1 - y0) * t) / g);
        const key = gx + ',' + gy;
        if (key === last) continue;
        last = key;
        ctx.fillRect(gx * g, gy * g, Math.ceil(g), Math.ceil(g));
      }
      break;
    }
    case 4: { // spores: soft glowing blobs + specks
      const r = rng(seed * 31337 + i * 7);
      ctx.globalCompositeOperation = 'lighter';
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / Math.max(2, w * 0.35)));
      for (let k = 0; k < n; k++) {
        const t = (k + r()) / n;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.6);
        g.addColorStop(0, css(color) + '55');
        g.addColorStop(1, css(color) + '00');
        ctx.fillStyle = g;
        ctx.fillRect(x - w * 0.6, y - w * 0.6, w * 1.2, w * 1.2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fffbe8';
      for (let k = 0; k < n * 2; k++) {
        if (r() > 0.5) continue;
        const t = r();
        ctx.globalAlpha = 0.6 + r() * 0.4;
        const a = r() * Math.PI * 2, d = r() * w * 0.5;
        ctx.fillRect(Math.round(x0 + (x1 - x0) * t + Math.cos(a) * d), Math.round(y0 + (y1 - y0) * t + Math.sin(a) * d), 1, 1);
      }
      break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function drawStroke(ctx: CanvasRenderingContext2D, panelH: number, d: StrokeData) {
  const [tool, color, size, seed, pts] = d;
  if (pts.length === 2) { drawSegment(ctx, panelH, tool, color, size, seed, 0, pts[0], pts[1], pts[0], pts[1]); return; }
  for (let i = 0; i + 3 < pts.length; i += 2) drawSegment(ctx, panelH, tool, color, size, seed, i / 2, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
}

export class PaintLayer {
  views = new Map<string, PanelView>();
  pending = new Map<string, StrokeData[]>(); // strokes received before the panel was loaded
  loaded = new Set<string>();
  group = new THREE.Group();
  mat?: THREE.Material;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  view(id: string): PanelView | null {
    let v = this.views.get(id);
    if (v) return v;
    const panel = PANEL_BY_ID.get(id);
    if (!panel) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(panel.w * PX_PER_M);
    canvas.height = Math.ceil(panel.h * PX_PER_M);
    const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(panel.w, panel.h), mat);
    mesh.position.set(
      panel.ox + panel.ux * panel.w / 2 + panel.nx * 0.004,
      panel.oy + panel.h / 2,
      panel.oz + panel.uz * panel.w / 2 + panel.nz * 0.004,
    );
    mesh.rotation.y = Math.atan2(panel.nx, panel.nz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = 1;
    this.group.add(mesh);
    v = { panel, canvas, ctx, tex, mesh, dirty: false };
    this.views.set(id, v);
    return v;
  }

  /** apply a complete stroke (remote or loaded) */
  add(id: string, d: StrokeData) {
    const v = this.view(id);
    if (!v) return;
    drawStroke(v.ctx, v.panel.h, d);
    v.dirty = true;
  }

  /** draw one live segment (local drawing) */
  segment(id: string, tool: number, color: number, size: number, seed: number, i: number, u0: number, v0: number, u1: number, v1: number) {
    const v = this.view(id);
    if (!v) return;
    drawSegment(v.ctx, v.panel.h, tool, color, size, seed, i, u0, v0, u1, v1);
    v.dirty = true;
  }

  flush() {
    for (const v of this.views.values()) if (v.dirty) { v.tex.needsUpdate = true; v.dirty = false; }
  }

  /** Load strokes of panels in batches, nearest first */
  async loadAll(api: string, counts: Record<string, number>, near: { x: number; y: number; z: number }) {
    const ids = Object.keys(counts).filter((id) => counts[id] > 0 && PANEL_BY_ID.has(id) && !this.loaded.has(id));
    const dist = (id: string) => {
      const p = PANEL_BY_ID.get(id)!;
      return Math.hypot(p.ox + p.ux * p.w / 2 - near.x, p.oy - near.y, p.oz + p.uz * p.w / 2 - near.z);
    };
    ids.sort((a, b) => dist(a) - dist(b));
    for (let i = 0; i < ids.length; i += 12) {
      const batch = ids.slice(i, i + 12);
      try {
        const r = await fetch(`${api}/api/panels?ids=${batch.join(',')}`);
        const data = (await r.json()) as Record<string, StrokeData[]>;
        for (const id of batch) {
          // draw stored strokes first, then any live strokes that arrived meanwhile
          for (const s of data[id] || []) this.add(id, s);
          for (const s of this.pending.get(id) || []) this.add(id, s);
          this.pending.delete(id);
          this.loaded.add(id);
        }
        this.flush();
      } catch (e) {
        console.warn('panel load failed', e);
      }
    }
  }

  /** a remote stroke arrived */
  remote(id: string, d: StrokeData, panelHasHistory: boolean) {
    if (panelHasHistory && !this.loaded.has(id)) {
      if (!this.pending.has(id)) this.pending.set(id, []);
      this.pending.get(id)!.push(d);
      return;
    }
    this.add(id, d);
  }
}

export { PANELS };
