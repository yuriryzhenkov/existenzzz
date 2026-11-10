import * as THREE from 'three';
import {
  CENTER, DOORS, DOOR_H, DOOR_THICK, FLOOR_H, LEVELS, LEVEL_GRIDS, PAD_H, SEGS, SEG_H, SIZE, SLAB, STATIC_BOXES, blockAt, segSolid, doorKey, groundKey, groundLayers, layerY, parseKey,
  blockKey, cellAt, isPerimeter, isStair, onIsland, stairH, type Door, type WorldState,
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

  type Meshers = Record<K, Mesher>;
  const newMeshers = () => Object.fromEntries(Object.keys(M).map((k) => [k, new Mesher()])) as Meshers;
  const toGroup = (D: Meshers) => {
    const grp = new THREE.Group();
    for (const k of Object.keys(D) as K[]) if (D[k].idx.length) grp.add(D[k].build(M[k]));
    return grp;
  };
  /** a part of the world that can be rebuilt when the pickaxe changes it */
  const part = (build: () => THREE.Group) => {
    let g = build();
    scene.add(g);
    return () => {
      scene.remove(g);
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      g = build();
      scene.add(g);
    };
  };

  // ---------------- mushrooms (the giant one is the heart) ----------------
  const rebuildShrooms = part(() => {
    const D = newMeshers();
    for (const b of STATIC_BOXES) {
      if (b.key && ws.broken(b.key)) continue;
      const sp = b.species ?? 0;
      if (b.kind === 'stem') D.stem.box(b, 'XxZz', SPECIES[sp].stem, 0.75);
      else if (b.kind === 'cap') {
        (b.species === undefined ? D.heart : D[`sp${sp}` as K]).box(b, 'XxZzY', W, 0.85);
        D.gill.box(b, 'y');
      }
    }
    return toGroup(D);
  });

  // ---------------- the island: moss top, flesh in 1 m layers, belly over the void ----------------
  const R = 47, lo = Math.floor(CENTER - R), hi = Math.ceil(CENTER + R);
  const inBuilding = (x: number, z: number) => x >= 0 && z >= 0 && x < SIZE && z < SIZE;
  const rebuildGround = part(() => {
    const D = newMeshers();
    // only columns with wounds need key lookups
    const cols = new Set<number>();
    for (const key of ws.all ? ws.all() : []) { const p = parseKey(key); if (p.L < 0 || (p.L === 0 && p.s === -1)) cols.add(p.x * 1000 + p.z); }
    const solid = (x: number, z: number, k: number) => {
      const n = groundLayers(x, z);
      if (!n || k > n) return false;
      return !cols.has(x * 1000 + z) || !ws.broken(groundKey(x, z, k));
    };
    for (let z = lo; z < hi; z++) {
      // moss top outside the building, merged into runs
      let run = -1;
      for (let x = lo; x <= hi; x++) {
        const ok = x < hi && !inBuilding(x, z) && solid(x, z, 0);
        if (ok && run === -1) run = x;
        if (!ok && run !== -1) { D.moss.box({ x0: run, y0: -SLAB, z0: z, x1: x, y1: 0, z1: z + 1 }, 'Y'); run = -1; }
      }
      for (let x = lo; x < hi; x++) {
        const n = groundLayers(x, z);
        if (!n) continue;
        for (let k = 0; k <= n; k++) {
          if (!solid(x, z, k)) continue;
          const [yb, yt] = layerY(x, z, k);
          const box = { x0: x, y0: yb, z0: z, x1: x + 1, y1: yt, z1: z + 1 };
          // top: a dug-out cavity above (the top plate's own top is moss / the floor finish)
          if (k > 0 && !solid(x, z, k - 1)) D.soil.box(box, 'Y');
          // bottom: the belly, or the ceiling of a cavity below
          if (k === n) D.belly.box(box, 'y', [0.7, 0.62, 0.66]);
          else if (!solid(x, z, k + 1)) D.soil.box(box, 'y');
          for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
            const nx = x + dx, nz = z + dz, nn = groundLayers(nx, nz);
            if (k > nn || nn === 0) { D.belly.box(box, f, [0.75, 0.66, 0.7], 0.6); continue; } // outer skin
            if (!solid(nx, nz, k)) { D.soil.box(box, f, W, 0.8); continue; } // wall of a dug cavity
            const nb = layerY(nx, nz, k)[0];
            if (nb > yb + 1e-3) D.belly.box({ ...box, y1: nb }, f, [0.75, 0.66, 0.7], 0.6); // the neighbour is shallower
          }
        }
      }
    }
    return toGroup(D);
  });

  // ---------------- dynamic parts: per level (walls are tissue segments, slabs can be dug) ----------------
  const levelGroups: THREE.Group[] = [];
  const finishOf = (L: number, x: number, z: number): K => (L === LEVELS - 1 ? 'roe' : L === 0 ? (inAtrium(x, z) ? 'soil' : 'nacre') : 'felt');

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
    // bounce pads (glowing mushrooms)
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const c = g[z][x];
      if ((c !== 'b' && c !== 'B') || ws.broken(blockKey(L, x, z, 0))) continue;
      const e = c === 'B' ? 0.1 : 0;
      D.stem.box({ x0: x + 0.38, y0: base, z0: z + 0.38, x1: x + 0.62, y1: base + 0.3, z1: z + 0.62 }, 'XxZz');
      D.pad.box({ x0: x - e, y0: base + 0.3, z0: z - e, x1: x + 1 + e, y1: base + PAD_H, z1: z + 1 + e }, 'XxZzYy', W, 0.85);
    }
    // blocks: walls, window sills and lintels, door lintels, railings — all 0.9 m tissue blocks
    const solid = (x: number, z: number, sg: number) => blockAt(L, x, z, sg, ws);
    const structural = (c: string | null) => c === '#' || c === 'w' || c === 'D' || c === 'r';
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const c = g[z][x];
      if (isStair(c)) {
        if (ws.broken(blockKey(L, x, z, 0))) continue;
        // the stairs are vertebrae: bone body, cartilage disc on top
        const h = base + stairH(c);
        D.bone.box({ x0: x, y0: base, z0: z, x1: x + 1, y1: h - 0.08, z1: z + 1 }, 'XxZz', W, 0.75);
        D.cartilage.box({ x0: x + 0.04, y0: h - 0.08, z0: z + 0.04, x1: x + 0.96, y1: h, z1: z + 0.96 }, 'XxZzY', W, 1);
        continue;
      }
      if (!structural(c)) continue;
      const rail = c === 'r';
      const parapet = rail && L === LEVELS - 1 && isPerimeter(x, z);
      for (let s = 0; s < SEGS; s++) {
        if (!solid(x, z, s)) continue;
        const b = { x0: x, y0: base + s * SEG_H, z0: z, x1: x + 1, y1: base + (s + 1) * SEG_H, z1: z + 1 };
        const ao = s === 0 ? 0.75 : 1;
        for (const [f, dx, dz] of [['X', 1, 0], ['x', -1, 0], ['Z', 0, 1], ['z', 0, -1]] as const) {
          const n = cellAt(L, x + dx, z + dz);
          if (solid(x + dx, z + dz, s)) continue;
          if (n === null) { D.scales.box(b, f, W, ao); continue; } // outer skin
          if (segSolid(n, L, s)) { D.wound.box(b, f, W, 1); continue; } // the neighbour block was torn out
          if (parapet) D.scales.box(b, f, W, ao);
          else if (rail) D.bone.box(b, f, W, ao); // railing rib
          else if (structural(n)) D.bone.box(b, f, W, 1); // jamb of a window / doorway: bone in the cut
          else D.membrane.box(b, f, W, ao);
        }
        // top
        if (!solid(x, z, s + 1)) {
          if (segSolid(c, L, s + 1)) D.wound.box(b, 'Y');
          else if (s === SEGS - 1) { if (L + 1 < LEVELS && ws.broken(blockKey(L + 1, x, z, -1))) D.wound.box(b, 'Y'); }
          else if (parapet) D.scales.box(b, 'Y');
          else if (rail) D.sinew.box(b, 'Y'); // sinew handrail
          else D.bone.box(b, 'Y'); // window sill
        }
        // bottom
        if (s > 0 && !solid(x, z, s - 1)) {
          if (segSolid(c, L, s - 1)) D.wound.box(b, 'y');
          else D.bone.box(b, 'y'); // lintel underside
        }
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

  for (const v of doors.values()) v.left.visible = v.right.visible = !ws.broken(doorKey(v.door));

  /** the pickaxe changed these blocks: rebuild only what they touch */
  function refresh(keys: Iterable<string>) {
    const levels = new Set<number>();
    let ground = false, shrooms = false;
    for (const key of keys) {
      if (key.startsWith('m.')) { shrooms = true; continue; }
      const { L, s: sg } = parseKey(key);
      if (L < 0) { ground = true; continue; }
      if (L === 0 && sg === -1) ground = true;
      levels.add(L);
      if (sg === -1 && L > 0) levels.add(L - 1);
      if (sg === 0) for (const v of doors.values()) if (doorKey(v.door) === key) v.left.visible = v.right.visible = !ws.broken(key);
    }
    for (const L of levels) rebuildLevel(L);
    if (ground) rebuildGround();
    if (shrooms) rebuildShrooms();
    return { levels, ground };
  }

  return { doors, rebuildLevel, refresh, materials: M };
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
  // dug-out ground takes its cilia with it (and they grow back with the ground)
  const attr = geo.getAttribute('aBlade') as THREE.InstancedBufferAttribute;
  const heights = pts.filter((_, i) => i % 4 === 2);
  const refresh = (ws: WorldState) => {
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(arr[i * 4]), z = Math.floor(arr[i * 4 + 1]);
      arr[i * 4 + 2] = ws.broken(blockKey(0, x, z, -1)) ? 0 : heights[i];
    }
    attr.needsUpdate = true;
  };
  return { mesh, uniforms, count, refresh };
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
