import * as THREE from 'three';
import {
  CENTER, DOORS, DOOR_H, DOOR_THICK, FLOOR_H, LEVELS, LEVEL_GRIDS, PAD_H, RAIL_H, SEGS, SEG_H, SIZE, SLAB, STATIC_BOXES, WALL_H, WIN_HI, WIN_LO,
  blockKey, cellAt, isPerimeter, isStair, islandEdge, onIsland, stairH, type Door, type WorldState,
} from '../../shared/world';
import {
  boneTex, capTex, cartilageTex, feltTex, gillTex, lipTex, membraneTex, mossTex, nacreTex, roeTex, scalesTex, sinewTex, soilTex, stemTex, woundTex,
} from './textures';
import { LIFE, living } from './living';

// Materials follow docs/CONCEPT.md: the same roles as a building (frame, canvas walls, floors per level,
// stairs, rails, roof, facade) but grown by an organism. Everything answers to people nearby.

type V3 = [number, number, number];
type B = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };

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
      this.pos.push(...pts[k]); this.nor.push(...n); this.uv.push(uvs[k][0], uvs[k][1]); this.col.push(...(k < 2 ? cb : ct));
    }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** faces: x X z Z y Y (lower = negative side) */
  box(b: B, faces: string, tint: V3 = [1, 1, 1], ao = 0.8) {
    const { x0, y0, z0, x1, y1, z1 } = b;
    const bot: V3 = [tint[0] * ao, tint[1] * ao, tint[2] * ao];
    const h = y1 - y0;
    if (faces.includes('X')) this.quad([x1, y0, z1], [0, 0, -1], [0, 1, 0], [1, 0, 0], -z1, y0, z1 - z0, h, bot, tint);
    if (faces.includes('x')) this.quad([x0, y0, z0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], z0, y0, z1 - z0, h, bot, tint);
    if (faces.includes('Z')) this.quad([x0, y0, z1], [1, 0, 0], [0, 1, 0], [0, 0, 1], x0, y0, x1 - x0, h, bot, tint);
    if (faces.includes('z')) this.quad([x1, y0, z0], [-1, 0, 0], [0, 1, 0], [0, 0, -1], -x1, y0, x1 - x0, h, bot, tint);
    if (faces.includes('Y')) this.quad([x0, y1, z1], [1, 0, 0], [0, 0, -1], [0, 1, 0], x0, -z1, x1 - x0, z1 - z0, tint);
    if (faces.includes('y')) this.quad([x0, y0, z0], [1, 0, 0], [0, 0, 1], [0, -1, 0], x0, z0, x1 - x0, z1 - z0, tint);
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

const W: V3 = [1, 1, 1];
const inAtrium = (x: number, z: number) => x >= 15 && x <= 25 && z >= 15 && z <= 25;
const lam = (map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });

// real mushroom species keep their colours, but glow from inside (they are part of the organism)
const SPECIES: { cap: V3; spot: string | null; stem: V3; glow: number }[] = [
  { cap: [196, 46, 38], spot: '#f4efe4', stem: [1, 1, 0.97], glow: 0xff5a7a }, // fly agaric
  { cap: [116, 72, 40], spot: null, stem: [0.92, 0.86, 0.74], glow: 0xffb070 }, // porcini
  { cap: [232, 156, 46], spot: null, stem: [1, 0.78, 0.45], glow: 0xffd060 }, // chanterelle
  { cap: [184, 70, 92], spot: null, stem: [1, 0.98, 0.96], glow: 0xff70c0 }, // russula
  { cap: [214, 196, 168], spot: '#7a5a3e', stem: [0.95, 0.92, 0.86], glow: 0xd0f0ff }, // parasol
];
const shadeHex = (c: V3, k: number) => '#' + c.map((v) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0')).join('');

export interface DoorView { door: Door; left: THREE.Object3D; right: THREE.Object3D; open: number; target: number }

export function buildWorld(scene: THREE.Scene, ws: WorldState) {
  // ---------------- materials ----------------
  const M = {
    // frame: bone, faint marrow veins
    bone: living(lam(boneTex()), { veins: 0.25, veinColor: 0xffc890, veinScale: 1.6, halo: 0.35, haloColor: 0xffe0b0, reach: 3.5, base: 0.05 }),
    // canvas walls: membrane, strong veins that follow people
    membrane: living(lam(membraneTex()), { veins: 0.22, veinColor: 0xff7aa8, veinScale: 3, halo: 0.35, haloColor: 0xffc8dc, reach: 4, base: 0.14 }),
    // facade: dark scales, iridescent, tendons glow when someone is near (climb)
    scales: living(lam(scalesTex()), { veins: 0.45, veinColor: 0x6af0d0, veinScale: 2.2, halo: 0.45, haloColor: 0x60ffd8, reach: 5, iridescence: 0.6, base: 0.02 }),
    // ground floor: nacre, rings of light spread from footsteps
    nacre: living(lam(nacreTex()), { halo: 0.6, haloColor: 0xb8e8ff, reach: 4, ripple: 1, iridescence: 0.25, base: 0.03 }),
    // upper floors: hyphal felt, warm glow under feet
    felt: living(lam(feltTex()), { veins: 0.5, veinColor: 0xffb04a, veinScale: 0.8, halo: 0.7, haloColor: 0xffc070, reach: 3, ripple: 0.6, base: 0.05 }),
    // atrium: living soil, bioluminescent
    soil: living(lam(soilTex()), { veins: 0.9, veinColor: 0x5cffc8, veinScale: 0.7, halo: 0.8, haloColor: 0x7affd8, reach: 3.5, ripple: 0.8, base: 0.04 }),
    // roof: roe, eggs light up around people
    roe: living(lam(roeTex()), { veins: 0.6, veinColor: 0xb48cff, veinScale: 0.5, halo: 0.6, haloColor: 0xc8a8ff, reach: 3, ripple: 0.5, base: 0.05 }),
    wound: living(lam(woundTex()), { veins: 0.6, veinColor: 0xff3050, veinScale: 0.6, halo: 0.4, haloColor: 0xff8090, reach: 3, base: 0.15 }),
    cartilage: living(lam(cartilageTex()), { halo: 0.5, haloColor: 0xc0f0ff, reach: 2.5, base: 0.08 }),
    sinew: living(lam(sinewTex()), { veins: 0.4, veinColor: 0xff7060, halo: 0.3, haloColor: 0xff9080, reach: 2.5, base: 0.06 }),
    moss: living(lam(mossTex(), { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), { veins: 0.5, veinColor: 0x50e0c0, veinScale: 1.4, halo: 0.6, haloColor: 0x60ffe0, reach: 3, ripple: 0.6, base: 0.03 }),
    belly: living(lam(boneTex()), { veins: 1, veinColor: 0xff4070, veinScale: 2.5, base: 0.0 }),
    stem: living(lam(stemTex()), { veins: 0.5, veinColor: 0xffe0a0, veinScale: 1.2, halo: 0.4, haloColor: 0xfff0d0, reach: 3, base: 0.08 }),
    gill: living(lam(gillTex()), { veins: 0.4, veinColor: 0xff90c0, base: 0.15 }),
    pad: living(lam(capTex([120, 230, 150], '#e8ffe0', 53), { emissive: new THREE.Color(0x3fbf5a), emissiveIntensity: 0.6 }), { halo: 0.6, haloColor: 0x80ffa0, reach: 2 }),
    // the giant fly agaric is the heart: its cap beats
    heart: living(lam(capTex(SPECIES[0].cap, SPECIES[0].spot!, 60)), { veins: 1, veinColor: 0xff2050, veinScale: 0.9, halo: 0.6, haloColor: 0xff6080, reach: 8, base: 0.12 }),
    sp0: living(lam(capTex(SPECIES[0].cap, SPECIES[0].spot!, 60)), { veins: 0.6, veinColor: SPECIES[0].glow, base: 0.08 }),
    sp1: living(lam(capTex(SPECIES[1].cap, shadeHex(SPECIES[1].cap, 0.9), 61)), { veins: 0.6, veinColor: SPECIES[1].glow, base: 0.08 }),
    sp2: living(lam(capTex(SPECIES[2].cap, shadeHex(SPECIES[2].cap, 1.06), 62)), { veins: 0.6, veinColor: SPECIES[2].glow, base: 0.08 }),
    sp3: living(lam(capTex(SPECIES[3].cap, shadeHex(SPECIES[3].cap, 1.08), 63)), { veins: 0.6, veinColor: SPECIES[3].glow, base: 0.08 }),
    sp4: living(lam(capTex(SPECIES[4].cap, SPECIES[4].spot!, 64)), { veins: 0.6, veinColor: SPECIES[4].glow, base: 0.08 }),
  };
  type K = keyof typeof M;

  // ---------------- static parts ----------------
  const S = Object.fromEntries(Object.keys(M).map((k) => [k, new Mesher()])) as Record<K, Mesher>;
  for (let L = 0; L < LEVELS; L++) {
    const base = L * FLOOR_H;
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const c = LEVEL_GRIDS[L][z][x];
      const nb = (dx: number, dz: number) => cellAt(L, x + dx, z + dz);
      if (c === 'w' || c === 'D') {
        const cull = (n: string | null) => n === '#' || n === 'w' || n === 'D';
        for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
          if (cull(nb(dx, dz))) continue;
          const m = nb(dx, dz) === null ? S.scales : S.membrane;
          if (c === 'w') m.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + WIN_LO, z1: z + 1 }, f);
          m.box({ x0: x, y0: base + (c === 'w' ? WIN_HI : DOOR_H), z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, f, W, 1);
        }
        if (c === 'w') S.bone.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + WIN_LO, z1: z + 1 }, 'Y'); // sill
        S.bone.box({ x0: x, y0: base + (c === 'w' ? WIN_HI : DOOR_H), z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }, 'y'); // lintel
      } else if (c === 'r') {
        let f = '';
        if (nb(1, 0) !== 'r') f += 'X';
        if (nb(-1, 0) !== 'r') f += 'x';
        if (nb(0, 1) !== 'r') f += 'Z';
        if (nb(0, -1) !== 'r') f += 'z';
        if (L === LEVELS - 1 && isPerimeter(x, z)) {
          S.scales.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + RAIL_H, z1: z + 1 }, f + 'Y'); // the outer skin rises into a parapet
        } else {
          S.bone.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + RAIL_H - 0.12, z1: z + 1 }, f); // rib
          S.sinew.box({ x0: x, y0: base + RAIL_H - 0.12, z0: z, x1: x + 1, y1: base + RAIL_H, z1: z + 1 }, f + 'Y', W, 1); // sinew handrail
        }
      } else if (isStair(c)) {
        // the stairs are vertebrae: bone body, cartilage disc on top
        const h = base + stairH(c);
        S.bone.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: h - 0.08, z1: z + 1 }, 'XxZz', W, 0.75);
        S.cartilage.box({ x0: x + 0.04, y0: h - 0.08, z0: z + 0.04, x1: x + 0.96, y1: h, z1: z + 0.96 }, 'XxZzY', W, 1);
      } else if (c === 'b' || c === 'B') {
        const big = c === 'B', e = big ? 0.1 : 0;
        S.stem.box({ x0: x + 0.38, y0: base, z0: z + 0.38, x1: x + 0.62, y1: base + 0.3, z1: z + 0.62 }, 'XxZz');
        S.pad.box({ x0: x - e, y0: base + 0.3, z0: z - e, x1: x + 1 + e, y1: base + PAD_H, z1: z + 1 + e }, 'XxZzYy', W, 0.85);
      }
    }
  }
  for (const b of STATIC_BOXES) {
    const sp = b.species ?? 0;
    if (b.kind === 'stem') S.stem.box(b, 'XxZz', SPECIES[sp].stem, 0.75);
    else if (b.kind === 'cap') {
      (b.species === undefined ? S.heart : S[`sp${sp}` as K]).box(b, 'XxZzY', W, 0.85);
      S.gill.box(b, 'y');
    }
  }

  // ---------------- the island: surface outside the building + stalactite belly over the void ----------------
  const R = 47;
  const depth = (x: number, z: number) => {
    const dx = x + 0.5 - CENTER, dz = z + 0.5 - CENTER;
    const r = Math.hypot(dx, dz) / islandEdge(Math.atan2(dz, dx));
    const n = Math.sin(x * 0.7) * Math.cos(z * 0.6) * 1.5 + Math.sin((x + z) * 0.31) * 2;
    return Math.max(1.2, Math.round((Math.pow(Math.max(0, 1 - r), 0.55) * 20 + n + 1) * 2) / 2);
  };
  for (let z = Math.floor(CENTER - R); z < CENTER + R; z++) {
    let run = -1;
    for (let x = Math.floor(CENTER - R); x <= CENTER + R; x++) {
      const inBuilding = x >= 0 && z >= 0 && x < SIZE && z < SIZE;
      const ok = x < CENTER + R && onIsland(x + 0.5, z + 0.5) && !inBuilding;
      if (ok && run === -1) run = x;
      if (!ok && run !== -1) { S.moss.box({ x0: run, y0: -SLAB, z0: z, x1: x, y1: 0, z1: z + 1 }, 'Y'); run = -1; }
    }
    for (let x = Math.floor(CENTER - R); x < CENTER + R; x++) {
      if (!onIsland(x + 0.5, z + 0.5)) continue;
      const d = depth(x, z);
      S.belly.box({ x0: x, y0: -d, z0: z, x1: x + 1, y1: 0, z1: z + 1 }, 'y', [0.7, 0.62, 0.66]);
      for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
        const nx = x + dx, nz = z + dz;
        const nd = onIsland(nx + 0.5, nz + 0.5) ? depth(nx, nz) : 0;
        if (nd < d) S.belly.box({ x0: x, y0: -d, z0: z, x1: x + 1, y1: -nd, z1: z + 1 }, f, [0.75, 0.66, 0.7], 0.6);
      }
    }
  }
  const staticGroup = new THREE.Group();
  for (const k of Object.keys(S) as K[]) if (S[k].idx.length) staticGroup.add(S[k].build(M[k]));
  scene.add(staticGroup);

  // ---------------- dynamic parts: per level (walls are tissue segments, slabs can be dug) ----------------
  const levelGroups: THREE.Group[] = [];
  const finishOf = (L: number, x: number, z: number): K => (L === LEVELS - 1 ? 'roe' : L === 0 ? (inAtrium(x, z) ? 'soil' : 'nacre') : 'felt');
  const isWall = (L: number, x: number, z: number, s: number) => cellAt(L, x, z) === '#' && !ws.broken(blockKey(L, x, z, s));

  function buildLevel(L: number) {
    const D = Object.fromEntries(Object.keys(M).map((k) => [k, new Mesher()])) as Record<K, Mesher>;
    const base = L * FLOOR_H;
    const g = LEVEL_GRIDS[L];
    const slab = (x: number, z: number) => cellAt(L, x, z) !== null && cellAt(L, x, z) !== 'o' && !ws.broken(blockKey(L, x, z, -1));
    // slabs: top finish merged per row & material, bone ceiling below, wound/bone edges
    for (let z = 0; z < SIZE; z++) {
      let run = -1; let runK: K | null = null;
      for (let x = 0; x <= SIZE; x++) {
        const k = x < SIZE && slab(x, z) ? finishOf(L, x, z) : null;
        if (run >= 0 && k !== runK) {
          const box = { x0: run, y0: base - SLAB, z0: z, x1: x, y1: base, z1: z + 1 };
          D[runK!].box(box, 'Y');
          if (L > 0) D.bone.box(box, 'y', [1.1, 1.1, 1.1]);
          run = -1; runK = null;
        }
        if (k && run < 0) { run = x; runK = k; }
      }
      if (L > 0) for (let x = 0; x < SIZE; x++) {
        if (!slab(x, z)) continue;
        const b = { x0: x, y0: base - SLAB, z0: z, x1: x + 1, y1: base, z1: z + 1 };
        for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
          const n = cellAt(L, x + dx, z + dz);
          if (n === null) D.bone.box(b, f, W, 1); // the frame shows as a bone band on the facade
          else if (!slab(x + dx, z + dz)) D.wound.box(b, f, W, 1); // holes and dug floors are open wounds
        }
      }
    }
    // wall tissue segments
    if (L < LEVELS - 1) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      if (g[z][x] !== '#') continue;
      for (let s = 0; s < SEGS; s++) {
        if (!isWall(L, x, z, s)) continue;
        const b = { x0: x, y0: base + s * SEG_H, z0: z, x1: x + 1, y1: base + (s + 1) * SEG_H, z1: z + 1 };
        for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
          const n = cellAt(L, x + dx, z + dz);
          if (n === '#') { if (!isWall(L, x + dx, z + dz, s)) D.wound.box(b, f, W, 1); continue; }
          if (n === 'w' || n === 'D') { D.bone.box(b, f, W, 1); continue; } // the jamb of a window / doorway: the bone shows in the cut
          (n === null ? D.scales : D.membrane).box(b, f, W, s === 0 ? 0.75 : 1);
        }
        if (s < SEGS - 1 && !isWall(L, x, z, s + 1)) D.wound.box(b, 'Y');
        if (s === SEGS - 1 && L + 1 < LEVELS && ws.broken(blockKey(L + 1, x, z, -1))) D.wound.box(b, 'Y');
        if (s > 0 && !isWall(L, x, z, s - 1)) D.wound.box(b, 'y');
      }
    }
    const grp = new THREE.Group();
    for (const k of Object.keys(D) as K[]) if (D[k].idx.length) grp.add(D[k].build(M[k]));
    return grp;
  }
  for (let L = 0; L < LEVELS; L++) { const g = buildLevel(L); levelGroups.push(g); scene.add(g); }
  const rebuildLevel = (L: number) => {
    if (L < 0 || L >= LEVELS) return;
    const old = levelGroups[L];
    scene.remove(old);
    old.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    levelGroups[L] = buildLevel(L);
    scene.add(levelGroups[L]);
  };

  // ---------------- doors: two lips of membrane that part ----------------
  const lipMat = living(new THREE.MeshLambertMaterial({ map: lipTex() }), { veins: 0.8, veinColor: 0xff4080, veinScale: 0.6, halo: 0.5, haloColor: 0xff90b0, reach: 3, base: 0.08 });
  const doors = new Map<string, DoorView>();
  for (const d of DOORS) {
    const base = d.level * FLOOR_H;
    const half = d.len / 2;
    const mk = (side: -1 | 1) => {
      const pivot = new THREE.Group();
      const geo = new THREE.BoxGeometry(half, DOOR_H - 0.02, DOOR_THICK + 0.1);
      geo.translate(-half / 2, DOOR_H / 2, 0); // anchored at its outer (right) edge
      pivot.add(new THREE.Mesh(geo, lipMat));
      if (d.axis === 'x') pivot.position.set(side < 0 ? d.x0 : d.x0 + d.len, base, d.z0 + 0.5);
      else { pivot.position.set(d.x0 + 0.5, base, side < 0 ? d.z0 : d.z0 + d.len); pivot.rotation.y = -Math.PI / 2; }
      if (side < 0) pivot.scale.x = -1; // mirror the left lip
      scene.add(pivot);
      return pivot;
    };
    const v: DoorView = { door: d, left: mk(-1), right: mk(1), open: 0, target: 1 };
    doors.set(d.id, v);
  }

  return { doors, rebuildLevel, materials: M };
}

export function updateDoors(doors: Map<string, DoorView>, dt: number) {
  for (const v of doors.values()) {
    if (Math.abs(v.open - v.target) < 0.001) continue;
    v.open += (v.target - v.open) * Math.min(1, dt * 7);
    if (Math.abs(v.open - v.target) < 0.002) v.open = v.target;
    const k = 1 - v.open * 0.88; // open lips retract to 12% of their width
    v.left.scale.x = -k; v.right.scale.x = k;
  }
}

// ---------------- cilia: the island's "grass" — instanced blades that bend away from people ----------------
export function buildCilia(scene: THREE.Scene, mobile: boolean) {
  const pts: number[] = [];
  let s = 4242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const per = mobile ? 0.9 : 2.2;
  for (let z = Math.floor(CENTER - 46); z < CENTER + 46; z++) for (let x = Math.floor(CENTER - 46); x < CENTER + 46; x++) {
    if (x >= -1 && z >= -1 && x <= SIZE && z <= SIZE) continue;
    const n = Math.floor(per + rnd());
    for (let i = 0; i < n; i++) {
      const px = x + rnd(), pz = z + rnd();
      if (!onIsland(px, pz)) continue;
      pts.push(px, pz, 0.3 + rnd() * 0.45, rnd() * Math.PI);
    }
  }
  const count = pts.length / 4;
  const blade = new THREE.PlaneGeometry(0.07, 1, 1, 3);
  blade.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute('position', blade.getAttribute('position'));
  geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(new Float32Array(pts), 4));
  geo.instanceCount = count;
  const uniforms = {
    ...LIFE,
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 10 },
    fogFar: { value: 100 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aBlade; // x, z, height, angle
      uniform vec4 uPeople[8];
      uniform float uTime;
      varying float vH; varying float vNear; varying float vDepth;
      void main() {
        float h = aBlade.z;
        vec3 p = position;
        float c = cos(aBlade.w), s = sin(aBlade.w);
        p.xz = vec2(p.x * c, p.x * s);
        float y = p.y * h;
        vec3 root = vec3(aBlade.x, 0.0, aBlade.y);
        vec2 push = vec2(0.0); float near = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 q = uPeople[i];
          if (q.w <= 0.0 || abs(q.y) > 1.5) continue;
          vec2 d = root.xz - q.xz;
          float l = length(d);
          float k = smoothstep(1.8, 0.0, l) * q.w;
          push += normalize(d + 1e-4) * k;
          near = max(near, k);
        }
        float bend = p.y * p.y;
        vec2 sway = vec2(sin(uTime * 1.3 + root.x * 0.7), cos(uTime * 1.1 + root.z * 0.6)) * 0.12;
        vec3 w = root + vec3(p.x, y, p.z);
        w.xz += (push * 0.9 + sway) * bend * h;
        w.y -= length(push) * bend * h * 0.45;
        vH = p.y; vNear = near;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBeat;
      uniform vec3 fogColor; uniform float fogNear, fogFar;
      varying float vH; varying float vNear; varying float vDepth;
      void main() {
        vec3 baseC = vec3(0.10, 0.20, 0.22);
        vec3 tipC = mix(vec3(0.35, 0.95, 0.85), vec3(1.0, 0.55, 0.85), vNear);
        vec3 col = mix(baseC, tipC, smoothstep(0.4, 1.0, vH)) * (0.6 + vNear * (1.2 + uBeat * 0.6));
        col = mix(col, fogColor, smoothstep(fogNear, fogFar, vDepth));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, uniforms, count };
}

// ---------------- the void below: dim spores drifting up ----------------
export function buildVoid(scene: THREE.Scene) {
  const n = 900;
  const p = new Float32Array(n * 3);
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 20 + rnd() * 140;
    p[i * 3] = CENTER + Math.cos(a) * r; p[i * 3 + 1] = -10 - rnd() * 120; p[i * 3 + 2] = CENTER + Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: LIFE.uTime },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; varying float vA;
      void main() { vec3 q = position; q.y = mod(q.y + uTime * 1.5 + 130.0, 130.0) - 138.0; q.x += sin(uTime * 0.2 + position.z) * 2.0;
        vec4 mv = modelViewMatrix * vec4(q, 1.0); vA = smoothstep(-138.0, -50.0, q.y) * smoothstep(-6.0, -24.0, q.y);
        gl_PointSize = clamp(260.0 / -mv.z, 1.0, 4.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(vec3(0.75, 0.55, 1.0) * vA, 1.0); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}
