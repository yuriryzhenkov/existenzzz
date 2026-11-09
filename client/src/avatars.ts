import * as THREE from 'three';
import type { PlayerInfo, PState } from '../../shared/protocol';
import { F_CROUCH, F_DRAWING, F_MOVING } from '../../shared/protocol';
import { mushroomFace } from './textures';

const INTERP_DELAY = 140; // ms

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const boxGeo = (w: number, h: number, d: number, pivotTop = false) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) g.translate(0, -h / 2, 0);
  return g;
};
const GEO = {
  head: boxGeo(0.5, 0.5, 0.5),
  body: boxGeo(0.5, 0.7, 0.28),
  limb: boxGeo(0.22, 0.7, 0.22, true),
};
const skinMat = new THREE.MeshLambertMaterial({ color: 0xf0d2b8 });

export function avatarUrl(photo: string, api: string) {
  return photo.startsWith('/') ? api + photo : `${api}/api/avatar?u=${encodeURIComponent(photo)}`;
}

function faceTexture(info: PlayerInfo, api: string): THREE.Texture {
  const tex = new THREE.CanvasTexture(mushroomFace(info.uid));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (info.photo) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // downsample to 16x16 for the pixel look
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, 16, 16);
      tex.image = c;
      tex.needsUpdate = true;
    };
    img.src = avatarUrl(info.photo, api);
  }
  return tex;
}

function nameSprite(name: string, color: string) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 28px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(name).width) + 24;
  c.width = w; c.height = 44;
  ctx.font = font;
  ctx.fillStyle = 'rgba(20,14,34,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 44, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(8, 18, 6, 6);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 18, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, fog: false }));
  sp.scale.set(w / 110, 44 / 110, 1);
  sp.center.set(0.5, 0);
  return sp;
}

interface Snap { t: number; x: number; y: number; z: number; yaw: number; pitch: number; f: number }

export class Avatar {
  info: PlayerInfo;
  root = new THREE.Group();
  head: THREE.Group;
  armL: THREE.Mesh; armR: THREE.Mesh; legL: THREE.Mesh; legR: THREE.Mesh; body: THREE.Mesh;
  snaps: Snap[] = [];
  label!: THREE.Sprite;
  x = 0; y = 0; z = 0; yaw = 0; pitch = 0; flags = 0;
  phase = 0;
  hasState = false;
  color: THREE.Color;
  personal: number; // stable hash for music

  constructor(info: PlayerInfo, api: string) {
    this.info = info;
    this.personal = hash(info.uid);
    this.color = new THREE.Color().setHSL((this.personal % 360) / 360, 0.5, 0.55);
    const shirt = new THREE.MeshLambertMaterial({ color: this.color });
    const pants = new THREE.MeshLambertMaterial({ color: this.color.clone().multiplyScalar(0.45) });
    const face = new THREE.MeshLambertMaterial({ map: faceTexture(info, api) });
    const hair = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((this.personal >> 8) % 360) / 360, 0.35, 0.3) });
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z ; avatar faces +z (local), we rotate root so +z = facing
    this.head = new THREE.Group();
    const headMesh = new THREE.Mesh(GEO.head, [skinMat, skinMat, hair, skinMat, face, hair]);
    this.head.add(headMesh);
    this.head.position.y = 1.4 + 0.25;
    this.body = new THREE.Mesh(GEO.body, shirt);
    this.body.position.y = 0.7 + 0.35;
    this.armL = new THREE.Mesh(GEO.limb, shirt); this.armL.position.set(-0.36, 1.4, 0);
    this.armR = new THREE.Mesh(GEO.limb, shirt); this.armR.position.set(0.36, 1.4, 0);
    this.legL = new THREE.Mesh(GEO.limb, pants); this.legL.position.set(-0.125, 0.7, 0);
    this.legR = new THREE.Mesh(GEO.limb, pants); this.legR.position.set(0.125, 0.7, 0);
    this.label = nameSprite(info.name, '#' + this.color.getHexString());
    this.label.position.y = 2.05;
    this.root.add(this.head, this.body, this.armL, this.armR, this.legL, this.legR, this.label);
    this.root.scale.setScalar(0.95);
    this.root.visible = false;
  }

  push(s: PState) {
    const now = performance.now();
    this.snaps.push({ t: now, x: s[1], y: s[2], z: s[3], yaw: s[4], pitch: s[5], f: s[6] });
    if (this.snaps.length > 20) this.snaps.shift();
    if (!this.hasState) { this.hasState = true; this.x = s[1]; this.y = s[2]; this.z = s[3]; this.yaw = s[4]; this.root.visible = true; }
  }

  direct = false; // self avatar (mirrors): pose set every frame, no interpolation

  setDirect(x: number, y: number, z: number, yaw: number, pitch: number, flags: number) {
    this.direct = true;
    if (!this.hasState) { this.x = x; this.z = z; }
    this.hasState = true;
    this.nx = x; this.ny = y; this.nz = z; this.nyaw = yaw; this.npitch = pitch; this.flags = flags;
  }
  private nx = 0; private ny = 0; private nz = 0; private nyaw = 0; private npitch = 0;

  update(dt: number, camPos: THREE.Vector3) {
    if (!this.hasState) return;
    if (this.direct) {
      const px = this.x, pz = this.z;
      this.x = this.nx; this.y = this.ny; this.z = this.nz; this.yaw = this.nyaw; this.pitch = this.npitch;
      this.pose(dt, camPos, px, pz);
      return;
    }
    const rt = performance.now() - INTERP_DELAY;
    const sn = this.snaps;
    let a = sn[0], b = sn[sn.length - 1];
    for (let i = 0; i < sn.length - 1; i++) if (sn[i].t <= rt && sn[i + 1].t >= rt) { a = sn[i]; b = sn[i + 1]; break; }
    let k = b.t === a.t ? 1 : (rt - a.t) / (b.t - a.t);
    k = Math.max(0, Math.min(1, k));
    const px = this.x, pz = this.z;
    this.x = a.x + (b.x - a.x) * k;
    this.y = a.y + (b.y - a.y) * k;
    this.z = a.z + (b.z - a.z) * k;
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw = a.yaw + dy * k;
    this.pitch = a.pitch + (b.pitch - a.pitch) * k;
    this.flags = b.f;
    this.pose(dt, camPos, px, pz);
  }

  private pose(dt: number, camPos: THREE.Vector3, px: number, pz: number) {
    const dist = camPos.distanceTo(this.root.position);
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw + Math.PI; // model faces +z, yaw 0 looks -z
    if (dist > 70) return; // skip animation far away

    const speed = Math.hypot(this.x - px, this.z - pz) / Math.max(dt, 1e-3);
    const moving = (this.flags & F_MOVING) || speed > 0.5;
    this.phase += dt * (moving ? Math.min(12, 4 + speed * 1.6) : 0);
    const swing = moving ? Math.sin(this.phase) * 0.7 : 0;
    this.legL.rotation.x = swing; this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    const crouch = !!(this.flags & F_CROUCH);
    this.body.rotation.x = crouch ? 0.45 : 0;
    this.root.position.y = this.y - (crouch ? 0.25 : 0);
    this.head.rotation.x = -this.pitch * 0.8;
    this.armR.rotation.x = this.flags & F_DRAWING ? -Math.PI / 2 - this.pitch + Math.sin(performance.now() / 90) * 0.1 : swing * 0.8;
  }

  rename(name: string) {
    this.info.name = name;
    const old = this.label;
    this.label = nameSprite(name, '#' + this.color.getHexString());
    this.label.position.y = 2.05;
    this.root.remove(old);
    old.material.map?.dispose(); old.material.dispose();
    this.root.add(this.label);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
