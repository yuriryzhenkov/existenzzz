import * as THREE from 'three';
import {
  CENTER, DOORS, DOOR_H, DOOR_THICK, FLOOR_H, LEVELS, LEVEL_GRIDS, PAD_H, RAIL_H, SIZE, SLAB, STATIC_BOXES, WALL_H, WIN_HI, WIN_LO,
  cellAt, isStair, stairH, type Door,
} from '../../shared/world';
import { capTex, doorTex, floorTex, gillTex, grassTex, stemTex, stoneTex, woodTex } from './textures';

type V3 = [number, number, number];

class Mesher {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  quad(bl: V3, R: V3, U: V3, n: V3, u0: number, v0: number, w: number, h: number, cb: V3, ct: V3 = cb) {
    const i = this.pos.length / 3;
    const pts: V3[] = [
      bl,
      [bl[0] + R[0] * w, bl[1] + R[1] * w, bl[2] + R[2] * w],
      [bl[0] + R[0] * w + U[0] * h, bl[1] + R[1] * w + U[1] * h, bl[2] + R[2] * w + U[2] * h],
      [bl[0] + U[0] * h, bl[1] + U[1] * h, bl[2] + U[2] * h],
    ];
    const uvs = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0, v0 + h]];
    for (let k = 0; k < 4; k++) {
      this.pos.push(...pts[k]);
      this.nor.push(...n);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.col.push(...(k < 2 ? cb : ct));
    }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** faces: string of which faces to emit: x X z Z y Y (lower = negative) */
  box(b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, faces: string, tint: V3, ao = 0.8) {
    const { x0, y0, z0, x1, y1, z1 } = b;
    const bot: V3 = [tint[0] * ao, tint[1] * ao, tint[2] * ao];
    const h = y1 - y0;
    if (faces.includes('X')) this.quad([x1, y0, z1], [0, 0, -1], [0, 1, 0], [1, 0, 0], -z1, y0, z1 - z0, h, bot, tint);
    if (faces.includes('x')) this.quad([x0, y0, z0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], z0, y0, z1 - z0, h, bot, tint);
    if (faces.includes('Z')) this.quad([x0, y0, z1], [1, 0, 0], [0, 1, 0], [0, 0, 1], x0, y0, x1 - x0, h, bot, tint);
    if (faces.includes('z')) this.quad([x1, y0, z0], [-1, 0, 0], [0, 1, 0], [0, 0, -1], -x1, y0, x1 - x0, h, bot, tint);
    if (faces.includes('Y')) this.quad([x0, y1, z1], [1, 0, 0], [0, 0, -1], [0, 1, 0], x0, -z1, x1 - x0, z1 - z0, tint);
    if (faces.includes('y')) this.quad([x0, y0, z0], [1, 0, 0], [0, 0, 1], [0, -1, 0], x0, z0, x1 - x0, z1 - z0, [tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.7]);
  }
  build(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    return m;
  }
}

const LEVEL_TINT: V3[] = [[0.95, 0.9, 1.0], [0.86, 0.98, 0.92], [1.0, 0.9, 0.84]];
function cellTint(base: V3, x: number, z: number): V3 {
  const n = ((x * 73856093) ^ (z * 19349663)) & 255;
  const k = 0.95 + (n / 255) * 0.08;
  return [base[0] * k, base[1] * k, base[2] * k];
}

export interface DoorView { door: Door; pivot: THREE.Object3D; angle: number; target: number }

export function buildWorld(scene: THREE.Scene) {
  const lambert = (map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });
  const mats = {
    wall: lambert(stoneTex()),
    floor: lambert(floorTex()),
    wood: lambert(woodTex()),
    grass: lambert(grassTex(), { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    stem: lambert(stemTex(), { emissive: new THREE.Color(0x3a3026), emissiveIntensity: 0.6 }),
    cap: lambert(capTex([214, 70, 70])),
    capWhite: lambert(capTex([255, 255, 255], '#ffffff', 52)),
    gill: lambert(gillTex()),
    pad: lambert(capTex([90, 200, 230], '#e8fbff', 53), { emissive: new THREE.Color(0x1b6f8a), emissiveIntensity: 0.6 }),
  };
  const M = Object.fromEntries(Object.keys(mats).map((k) => [k, new Mesher()])) as Record<keyof typeof mats, Mesher>;
  const isWallish = (c: string | null) => c === '#';

  for (let L = 0; L < LEVELS; L++) {
    const base = L * FLOOR_H;
    const tint = LEVEL_TINT[Math.min(L, 2)];
    const g = LEVEL_GRIDS[L];
    // ---- slab tops & bottoms, merged per row ----
    for (let z = 0; z < SIZE; z++) {
      let run = -1;
      for (let x = 0; x <= SIZE; x++) {
        const solid = x < SIZE && g[z][x] !== 'o';
        if (solid && run < 0) run = x;
        if (!solid && run >= 0) {
          const box = { x0: run, y0: base - SLAB, z0: z, x1: x, y1: base, z1: z + 1 };
          const mesher = L === LEVELS - 1 ? M.wall : M.floor;
          mesher.box(box, 'Y', L === LEVELS - 1 ? [0.82, 0.8, 0.9] : [1, 1, 1]);
          if (L > 0) M.wall.box(box, 'y', [0.9, 0.88, 0.95]);
          run = -1;
        }
      }
      if (L > 0) for (let x = 0; x < SIZE; x++) {
        if (g[z][x] === 'o') continue;
        const b = { x0: x, y0: base - SLAB, z0: z, x1: x + 1, y1: base, z1: z + 1 };
        let f = '';
        if ((cellAt(L, x + 1, z) ?? 'o') === 'o') f += 'X';
        if ((cellAt(L, x - 1, z) ?? 'o') === 'o') f += 'x';
        if ((cellAt(L, x, z + 1) ?? 'o') === 'o') f += 'Z';
        if ((cellAt(L, x, z - 1) ?? 'o') === 'o') f += 'z';
        if (f) M.wall.box(b, f, [0.75, 0.72, 0.8], 1);
      }
    }
    // ---- cells ----
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const c = g[z][x];
      const nb = (dx: number, dz: number) => cellAt(L, x + dx, z + dz);
      const t = cellTint(tint, x, z);
      if (c === '#') {
        let f = '';
        if (!isWallish(nb(1, 0))) f += 'X';
        if (!isWallish(nb(-1, 0))) f += 'x';
        if (!isWallish(nb(0, 1))) f += 'Z';
        if (!isWallish(nb(0, -1))) f += 'z';
        M.wall.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f, t, 0.72);
      } else if (c === 'w' || c === 'D') {
        const sideCull = (n: string | null) => n === '#' || n === 'w' || n === 'D';
        let f = '';
        if (!sideCull(nb(1, 0))) f += 'X';
        if (!sideCull(nb(-1, 0))) f += 'x';
        if (!sideCull(nb(0, 1))) f += 'Z';
        if (!sideCull(nb(0, -1))) f += 'z';
        if (c === 'w') {
          M.wall.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + WIN_LO, z1: z + 1 }, f + 'Y', t, 0.72);
          M.wall.box({ x0: x, y0: base + WIN_HI, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f + 'y', t, 0.95);
        } else {
          M.wall.box({ x0: x, y0: base + DOOR_H, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f + 'y', t, 0.95);
        }
      } else if (c === 'r') {
        let f = 'Y';
        if (nb(1, 0) !== 'r') f += 'X';
        if (nb(-1, 0) !== 'r') f += 'x';
        if (nb(0, 1) !== 'r') f += 'Z';
        if (nb(0, -1) !== 'r') f += 'z';
        M.wood.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + RAIL_H, z1: z + 1 }, f, [0.95, 0.85, 0.85], 0.75);
      } else if (isStair(c)) {
        M.wood.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + stairH(c), z1: z + 1 }, 'XxZzY', [1, 0.95, 0.9], 0.7);
      } else if (c === 'b' || c === 'B') {
        const big = c === 'B';
        M.stem.box({ x0: x + 0.38, y0: base, z0: z + 0.38, x1: x + 0.62, y1: base + 0.3, z1: z + 0.62 }, 'XxZz', [1, 1, 1]);
        M.pad.box({ x0: x + (big ? -0.1 : 0), y0: base + 0.3, z0: z + (big ? -0.1 : 0), x1: x + 1 + (big ? 0.1 : 0), y1: base + PAD_H, z1: z + 1 + (big ? 0.1 : 0) }, 'XxZzYy', big ? [1, 0.75, 1] : [1, 1, 1], 0.85);
      }
    }
  }

  // ---- mushrooms ----
  for (const b of STATIC_BOXES) {
    if (b.kind === 'stem') M.stem.box(b, 'XxZz', [1, 1, 1], 0.7);
    else if (b.kind === 'cap') {
      const isMeadow = b.hue !== undefined;
      if (isMeadow) {
        const col = new THREE.Color().setHSL(b.hue!, 0.55, 0.55);
        M.capWhite.box(b, 'XxZzY', [col.r, col.g, col.b], 0.85);
      } else M.cap.box(b, 'XxZzY', [1, 1, 1], 0.85);
      M.gill.box(b, 'y', [1, 1, 1]);
    }
  }

  // ---- ground (meadow) ----
  const R = 90;
  M.grass.quad([CENTER - R, 0, CENTER + R], [1, 0, 0], [0, 0, -1], [0, 1, 0], CENTER - R, -(CENTER + R), R * 2, R * 2, [1, 1, 1]);

  const group = new THREE.Group();
  for (const k of Object.keys(M) as (keyof typeof mats)[]) {
    if (M[k].idx.length) group.add(M[k].build(mats[k]));
  }
  scene.add(group);

  // ---- doors ----
  const dtex = doorTex();
  const doorMat = new THREE.MeshLambertMaterial({ map: dtex });
  const doors = new Map<string, DoorView>();
  for (const d of DOORS) {
    const pivot = new THREE.Group();
    const base = d.level * FLOOR_H;
    // hinge at the min end of the door, on the centre line
    if (d.axis === 'x') pivot.position.set(d.x0, base, d.z0 + 0.5);
    else pivot.position.set(d.x0 + 0.5, base, d.z0);
    const geo = new THREE.BoxGeometry(d.len, DOOR_H - 0.02, DOOR_THICK);
    const mesh = new THREE.Mesh(geo, doorMat);
    mesh.position.set(d.len / 2, DOOR_H / 2, 0);
    if (d.axis === 'z') pivot.rotation.y = -Math.PI / 2;
    pivot.userData.baseRot = pivot.rotation.y;
    pivot.add(mesh);
    scene.add(pivot);
    doors.set(d.id, { door: d, pivot, angle: 0, target: 0 });
  }

  return { group, doors };
}

export function updateDoors(doors: Map<string, DoorView>, dt: number) {
  for (const v of doors.values()) {
    if (Math.abs(v.angle - v.target) < 0.001) continue;
    v.angle += (v.target - v.angle) * Math.min(1, dt * 8);
    v.pivot.rotation.y = v.pivot.userData.baseRot + v.angle;
  }
}

export function buildSky(scene: THREE.Scene) {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const cols: number[] = [];
  const top = new THREE.Color('#1a1238'), mid = new THREE.Color('#5b3a78'), hor = new THREE.Color('#f0a6a0');
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 400;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else c.copy(hor).lerp(mid, Math.max(0, (y + 0.05) / 0.3));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  // stars
  const sp: number[] = [];
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    const a = rnd() * Math.PI * 2, e = 0.2 + rnd() * 1.3;
    sp.push(Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff4e0, size: 2, sizeAttenuation: false, fog: false }));
  scene.add(stars);
  return { sky, stars };
}
