import * as THREE from 'three';
import {
  CENTER, DOORS, DOOR_H, DOOR_THICK, FLOOR_H, LEVELS, LEVEL_GRIDS, PAD_H, RAIL_H, SIZE, SLAB, STATIC_BOXES, WALL_H, WIN_HI, WIN_LO,
  cellAt, isStair, stairH, type Door,
} from '../../shared/world';
import { brickTex, capTex, concreteTex, doorTex, gillTex, grassTex, myceliumTex, oakTex, plasterTex, roofTex, screedTex, soilTex, stemTex, woodTex } from './textures';

const shadeHex = (c: [number, number, number], k: number) => '#' + c.map((v) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0')).join('');

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

// Materials follow docs/MATERIALS.md: a real concrete/brick/plaster/oak building that mycelium grew through.
const W: V3 = [1, 1, 1];
const inAtrium = (x: number, z: number) => x >= 15 && x <= 25 && z >= 15 && z <= 25;

// real species: cap colour, spot colour (null = none), stem tint
const SPECIES: { cap: [number, number, number]; spot: string | null; stem: V3 }[] = [
  { cap: [196, 46, 38], spot: '#f4efe4', stem: [1, 1, 0.97] }, // fly agaric
  { cap: [116, 72, 40], spot: null, stem: [0.92, 0.86, 0.74] }, // porcini
  { cap: [232, 156, 46], spot: null, stem: [1, 0.78, 0.45] }, // chanterelle
  { cap: [184, 70, 92], spot: null, stem: [1, 0.98, 0.96] }, // russula
  { cap: [214, 196, 168], spot: '#7a5a3e', stem: [0.95, 0.92, 0.86] }, // parasol (brown scales)
];

export interface DoorView { door: Door; pivot: THREE.Object3D; angle: number; target: number }

export function buildWorld(scene: THREE.Scene) {
  const lambert = (map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });
  const mats = {
    concrete: lambert(concreteTex()),
    plaster: lambert(plasterTex()),
    brick: lambert(brickTex()),
    screed: lambert(screedTex()),
    oak: lambert(oakTex()),
    wood: lambert(woodTex()),
    soil: lambert(soilTex()),
    roof: lambert(roofTex()),
    mycelium: lambert(myceliumTex()),
    grass: lambert(grassTex(), { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    stem: lambert(stemTex()),
    gill: lambert(gillTex()),
    // bioluminescent mushrooms glow green, like Mycena / Panellus
    pad: lambert(capTex([150, 230, 150], '#e8ffe0', 53), { emissive: new THREE.Color(0x3fbf5a), emissiveIntensity: 0.55 }),
    sp0: lambert(capTex(SPECIES[0].cap, SPECIES[0].spot!, 60)),
    sp1: lambert(capTex(SPECIES[1].cap, shadeHex(SPECIES[1].cap, 0.9), 61)),
    sp2: lambert(capTex(SPECIES[2].cap, shadeHex(SPECIES[2].cap, 1.06), 62)),
    sp3: lambert(capTex(SPECIES[3].cap, shadeHex(SPECIES[3].cap, 1.08), 63)),
    sp4: lambert(capTex(SPECIES[4].cap, SPECIES[4].spot!, 64)),
  };
  const M = Object.fromEntries(Object.keys(mats).map((k) => [k, new Mesher()])) as Record<keyof typeof mats, Mesher>;
  const isWallish = (c: string | null) => c === '#';

  /** emit wall-ish faces: faces looking outside the building are brick, inside plaster */
  const wallFaces = (L: number, x: number, z: number, box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, faces: string, ao: number) => {
    for (const f of faces) {
      const d = f === 'X' ? [1, 0] : f === 'x' ? [-1, 0] : f === 'Z' ? [0, 1] : f === 'z' ? [0, -1] : null;
      if (!d) { M.concrete.box(box, f, W, ao); continue; } // sills & lintels: precast concrete
      const outside = cellAt(L, x + d[0], z + d[1]) === null;
      (outside ? M.brick : M.plaster).box(box, f, W, outside ? 0.85 : ao);
    }
  };

  for (let L = 0; L < LEVELS; L++) {
    const base = L * FLOOR_H;
    const g = LEVEL_GRIDS[L];
    // ---- slab tops (floor finish) & bottoms (bare concrete ceiling), merged per row & finish ----
    const finish = (x: number, z: number): Mesher => {
      if (L === LEVELS - 1) return M.roof;
      if (L === 0) return inAtrium(x, z) ? M.soil : M.screed;
      return M.oak;
    };
    for (let z = 0; z < SIZE; z++) {
      let run = -1;
      let runM: Mesher | null = null;
      for (let x = 0; x <= SIZE; x++) {
        const solid = x < SIZE && g[z][x] !== 'o';
        const m = solid ? finish(x, z) : null;
        if (run >= 0 && (!solid || m !== runM)) {
          const box = { x0: run, y0: base - SLAB, z0: z, x1: x, y1: base, z1: z + 1 };
          runM!.box(box, 'Y', W);
          if (L > 0) M.concrete.box(box, 'y', [1.3, 1.3, 1.3]); // compensate the darker underside so concrete reads as grey
          run = -1;
        }
        if (solid && run < 0) { run = x; runM = m; }
      }
      if (L > 0) for (let x = 0; x < SIZE; x++) {
        if (g[z][x] === 'o') continue;
        const b = { x0: x, y0: base - SLAB, z0: z, x1: x + 1, y1: base, z1: z + 1 };
        // slab edges: at holes they are eaten by mycelium; on the facade it is the concrete slab band
        for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
          const n = cellAt(L, x + dx, z + dz);
          if (n === 'o') M.mycelium.box(b, f, W, 1);
          else if (n === null) M.concrete.box(b, f, W, 1);
        }
      }
    }
    // ---- cells ----
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const c = g[z][x];
      const nb = (dx: number, dz: number) => cellAt(L, x + dx, z + dz);
      if (c === '#') {
        let f = '';
        if (!isWallish(nb(1, 0))) f += 'X';
        if (!isWallish(nb(-1, 0))) f += 'x';
        if (!isWallish(nb(0, 1))) f += 'Z';
        if (!isWallish(nb(0, -1))) f += 'z';
        wallFaces(L, x, z, { x0: x, y0: base, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f, 0.8);
      } else if (c === 'w' || c === 'D') {
        const sideCull = (n: string | null) => n === '#' || n === 'w' || n === 'D';
        let f = '';
        if (!sideCull(nb(1, 0))) f += 'X';
        if (!sideCull(nb(-1, 0))) f += 'x';
        if (!sideCull(nb(0, 1))) f += 'Z';
        if (!sideCull(nb(0, -1))) f += 'z';
        if (c === 'w') {
          wallFaces(L, x, z, { x0: x, y0: base, z0: z, x1: x + 1, y1: base + WIN_LO, z1: z + 1 }, f + 'Y', 0.8);
          wallFaces(L, x, z, { x0: x, y0: base + WIN_HI, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f + 'y', 1);
        } else {
          wallFaces(L, x, z, { x0: x, y0: base + DOOR_H, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f + 'y', 1);
        }
      } else if (c === 'r') {
        let f = '';
        if (nb(1, 0) !== 'r') f += 'X';
        if (nb(-1, 0) !== 'r') f += 'x';
        if (nb(0, 1) !== 'r') f += 'Z';
        if (nb(0, -1) !== 'r') f += 'z';
        const perimeter = L === LEVELS - 1 && (x === 0 || z === 0 || x === SIZE - 1 || z === SIZE - 1);
        if (perimeter) {
          // roof parapet: the brick facade continues above the roof
          M.brick.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + RAIL_H, z1: z + 1 }, f + 'Y', W, 0.8);
        } else {
          // gallery balustrade: concrete upstand (part of the slab) + oak handrail where hands touch
          M.concrete.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + RAIL_H - 0.12, z1: z + 1 }, f, W, 0.8);
          M.wood.box({ x0: x, y0: base + RAIL_H - 0.12, z0: z, x1: x + 1, y1: base + RAIL_H, z1: z + 1 }, f + 'Y', W, 0.95);
        }
      } else if (isStair(c)) {
        // concrete flight, oak treads
        const h = base + stairH(c);
        M.concrete.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: h - 0.05, z1: z + 1 }, 'XxZz', W, 0.8);
        M.wood.box({ x0: x, y0: h - 0.05, z0: z, x1: x + 1, y1: h, z1: z + 1 }, 'XxZzY', W, 1);
      } else if (c === 'b' || c === 'B') {
        const big = c === 'B';
        M.stem.box({ x0: x + 0.38, y0: base, z0: z + 0.38, x1: x + 0.62, y1: base + 0.3, z1: z + 0.62 }, 'XxZz', W);
        M.pad.box({ x0: x + (big ? -0.1 : 0), y0: base + 0.3, z0: z + (big ? -0.1 : 0), x1: x + 1 + (big ? 0.1 : 0), y1: base + PAD_H, z1: z + 1 + (big ? 0.1 : 0) }, 'XxZzYy', W, 0.85);
      }
    }
  }

  // ---- mushrooms: the giant one in the atrium is a fly agaric; meadow ones are real species ----
  for (const b of STATIC_BOXES) {
    const sp = b.species ?? 0;
    if (b.kind === 'stem') M.stem.box(b, 'XxZz', SPECIES[sp].stem, 0.75);
    else if (b.kind === 'cap') {
      M[`sp${sp}` as 'sp0'].box(b, 'XxZzY', W, 0.85);
      M.gill.box(b, 'y', W);
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
