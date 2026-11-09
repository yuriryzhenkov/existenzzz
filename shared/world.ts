// Shared world definition: used by client (render + physics) and server (validation).
// The building is a voxel grid of 1m cells, LEVELS floors, FLOOR_H meters per floor.
//
// Cell legend:
//   ' ' floor            'o' hole (no slab)          '#' wall (full height)
//   'w' window wall      'D' door                    'r' railing / parapet
//   '0'..'9' stair step (height (k+1)*0.5)            'b' small bounce mushroom, 'B' big one

export const SIZE = 41;
export const LEVELS = 4; // 0,1,2 = floors with walls, 3 = roof
export const FLOOR_H = 5;
export const WALL_H = 4.5;
export const SLAB = 0.5;
export const RAIL_H = 1.1;
export const WIN_LO = 1.2;
export const WIN_HI = 3.0;
export const DOOR_H = 3.0;
export const PAD_H = 0.6;
export const WORLD_R = 62; // walkable radius around building center
export const CENTER = SIZE / 2;

export type Grid = string[][]; // [z][x]

function blank(fill = ' '): Grid {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => fill));
}
function set(g: Grid, x: number, z: number, c: string) {
  if (x >= 0 && z >= 0 && x < SIZE && z < SIZE) g[z][x] = c;
}
function rect(g: Grid, x0: number, z0: number, x1: number, z1: number, c: string) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(g, x, z, c);
}
function hline(g: Grid, z: number, x0: number, x1: number, c: string) { rect(g, x0, z, x1, z, c); }
function vline(g: Grid, x: number, z0: number, z1: number, c: string) { rect(g, x, z0, x, z1, c); }

function floorLevel(level: number): Grid {
  const g = blank();
  const E = SIZE - 1;
  // outer walls
  hline(g, 0, 0, E, '#'); hline(g, E, 0, E, '#');
  vline(g, 0, 0, E, '#'); vline(g, E, 0, E, '#');
  // inner grid lines -> 3x3 blocks, centre block = corridor + atrium
  hline(g, 11, 0, E, '#'); hline(g, 29, 0, E, '#');
  vline(g, 11, 0, E, '#'); vline(g, 29, 0, E, '#');

  // centre <-> side rooms : 3 wide doors
  hline(g, 11, 19, 21, 'D'); hline(g, 29, 19, 21, 'D');
  vline(g, 11, 19, 21, 'D'); vline(g, 29, 19, 21, 'D');
  // side rooms <-> corner rooms
  vline(g, 11, 5, 6, 'D'); vline(g, 29, 5, 6, 'D');
  vline(g, 11, 34, 35, 'D'); vline(g, 29, 34, 35, 'D');
  hline(g, 11, 5, 6, 'D'); hline(g, 29, 5, 6, 'D');
  hline(g, 11, 34, 35, 'D'); hline(g, 29, 34, 35, 'D');

  // windows: centre <-> side rooms
  for (const [a, b] of [[14, 16], [24, 26]]) {
    hline(g, 11, a, b, 'w'); hline(g, 29, a, b, 'w');
    vline(g, 11, a, b, 'w'); vline(g, 29, a, b, 'w');
  }
  // windows to the outside
  for (const [a, b] of [[4, 7], [16, 17], [23, 24], [33, 36]]) {
    hline(g, 0, a, b, 'w'); hline(g, E, a, b, 'w');
    vline(g, 0, a, b, 'w'); vline(g, E, a, b, 'w');
  }

  if (level === 0) {
    // entrance from the meadow (south)
    hline(g, E, 19, 21, 'D');
    // bounce mushrooms in the atrium
    set(g, 16, 24, 'b');
    set(g, 24, 16, 'B');
    set(g, 24, 24, 'b');
    // stairs L0 -> L1 : west corridor, rising towards -z
    stairs(g, [12, 13], 26, -1);
  } else {
    // atrium void with railing ring
    rect(g, 14, 14, 26, 26, 'r');
    rect(g, 15, 15, 25, 25, 'o');
  }
  if (level === 1) {
    rect(g, 12, 17, 13, 26, 'o'); // hole over L0 stairs
    stairs(g, [27, 28], 14, +1); // L1 -> L2 : east corridor, rising towards +z
    rect(g, 33, 4, 35, 6, 'o'); // drop into NE room below
    rect(g, 18, 34, 20, 35, 'o'); // drop into south hall below
  }
  if (level === 2) {
    rect(g, 27, 14, 28, 23, 'o'); // hole over L1 stairs
    stairs(g, [12, 13], 26, -1); // L2 -> roof : west corridor
    rect(g, 4, 33, 6, 35, 'o'); // drop into SW room below
  }
  return g;
}

function stairs(g: Grid, xs: number[], zStart: number, dir: number) {
  for (let k = 0; k < 10; k++) for (const x of xs) set(g, x, zStart + dir * k, String(k));
}

function roofLevel(): Grid {
  const g = blank();
  const E = SIZE - 1;
  hline(g, 0, 0, E, 'r'); hline(g, E, 0, E, 'r');
  vline(g, 0, 0, E, 'r'); vline(g, E, 0, E, 'r');
  rect(g, 14, 14, 26, 26, 'r');
  rect(g, 15, 15, 25, 25, 'o');
  rect(g, 12, 17, 13, 26, 'o'); // hole over L2 stairs
  rect(g, 19, 4, 21, 6, 'o'); // skylight: jump into the north hall
  rect(g, 34, 34, 35, 35, 'o'); // skylight into SE room
  set(g, 6, 34, 'b');
  return g;
}

export const LEVEL_GRIDS: Grid[] = [floorLevel(0), floorLevel(1), floorLevel(2), roofLevel()];

export function cellAt(level: number, x: number, z: number): string | null {
  if (level < 0 || level >= LEVELS) return null;
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return null;
  return LEVEL_GRIDS[level][z][x];
}

export const isStair = (c: string | null) => c !== null && c >= '0' && c <= '9';
export const stairH = (c: string) => (c.charCodeAt(0) - 48 + 1) * 0.5;

// ---------- Giant mushrooms (extra solid objects) ----------
export interface Box { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; bounce?: number; kind?: string; hue?: number }

export const MUSHROOM_STEM: Box = { x0: 19.2, y0: 0, z0: 19.2, x1: 21.8, y1: 10.5, z1: 21.8, kind: 'stem' };
export const MUSHROOM_CAP: Box = { x0: 17, y0: 10.5, z0: 17, x1: 24, y1: 11.4, z1: 24, kind: 'cap' };
export const MUSHROOM_TOP: Box = { x0: 18, y0: 11.4, z0: 18, x1: 23, y1: 11.9, z1: 23, kind: 'cap' };

// Outdoor giant mushrooms on the meadow (deterministic)
export interface Shroom { x: number; z: number; h: number; r: number; hue: number }
export const MEADOW_SHROOMS: Shroom[] = (() => {
  const out: Shroom[] = [];
  let s = 1337;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 30 + rnd() * 26;
    out.push({ x: CENTER + Math.cos(a) * d, z: CENTER + Math.sin(a) * d, h: 3 + rnd() * 9, r: 1.5 + rnd() * 3.5, hue: rnd() });
  }
  return out;
})();

export const STATIC_BOXES: Box[] = [
  MUSHROOM_STEM,
  MUSHROOM_CAP,
  MUSHROOM_TOP,
  ...MEADOW_SHROOMS.flatMap((m): Box[] => [
    { x0: m.x - 0.4 - m.r * 0.15, y0: 0, z0: m.z - 0.4 - m.r * 0.15, x1: m.x + 0.4 + m.r * 0.15, y1: m.h, z1: m.z + 0.4 + m.r * 0.15, kind: 'stem' },
    { x0: m.x - m.r, y0: m.h, z0: m.z - m.r, x1: m.x + m.r, y1: m.h + 0.8, z1: m.z + m.r, kind: 'cap', hue: m.hue },
    { x0: m.x - m.r * 0.6, y0: m.h + 0.8, z0: m.z - m.r * 0.6, x1: m.x + m.r * 0.6, y1: m.h + 1.3, z1: m.z + m.r * 0.6, kind: 'cap', hue: m.hue, bounce: m.h < 7 ? 15 : 0 },
  ]),
];

export const BOUNCE_SMALL = 17;
export const BOUNCE_BIG = 22.5;

// ---------- Doors ----------
export interface Door {
  id: string;
  level: number;
  axis: 'x' | 'z'; // the axis the door spans along
  x0: number; z0: number; // min cell
  len: number;
}

export const DOORS: Door[] = (() => {
  const out: Door[] = [];
  for (let L = 0; L < LEVELS; L++) {
    const g = LEVEL_GRIDS[L];
    const seen = new Set<string>();
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      if (g[z][x] !== 'D' || seen.has(x + ',' + z)) continue;
      // decide axis: door cells continue along x or z
      const alongX = cellAt(L, x + 1, z) === 'D';
      let len = 0;
      if (alongX) { while (cellAt(L, x + len, z) === 'D') { seen.add(x + len + ',' + z); len++; } }
      else { while (cellAt(L, x, z + len) === 'D') { seen.add(x + ',' + (z + len)); len++; } }
      out.push({ id: `d${L}_${x}_${z}`, level: L, axis: alongX ? 'x' : 'z', x0: x, z0: z, len });
    }
  }
  return out;
})();
export const DOOR_BY_ID = new Map(DOORS.map((d) => [d.id, d]));
const DOOR_BY_CELL = new Map<string, Door>();
for (const d of DOORS) for (let i = 0; i < d.len; i++) {
  const x = d.axis === 'x' ? d.x0 + i : d.x0;
  const z = d.axis === 'z' ? d.z0 + i : d.z0;
  DOOR_BY_CELL.set(`${d.level},${x},${z}`, d);
}
export const doorAtCell = (L: number, x: number, z: number) => DOOR_BY_CELL.get(`${L},${x},${z}`);

export const DOOR_THICK = 0.2;
/** Collision box of a closed door */
export function doorBox(d: Door): Box {
  const y0 = d.level * FLOOR_H;
  if (d.axis === 'x') return { x0: d.x0, y0, z0: d.z0 + 0.5 - DOOR_THICK / 2, x1: d.x0 + d.len, y1: y0 + DOOR_H, z1: d.z0 + 0.5 + DOOR_THICK / 2 };
  return { x0: d.x0 + 0.5 - DOOR_THICK / 2, y0, z0: d.z0, x1: d.x0 + 0.5 + DOOR_THICK / 2, y1: y0 + DOOR_H, z1: d.z0 + d.len };
}

// ---------- Collision ----------
/** Push boxes of the voxel cell into out. doorsOpen: id -> open */
export function cellBoxes(L: number, x: number, z: number, out: Box[], doorOpen: (id: string) => boolean) {
  const base = L * FLOOR_H;
  const inside = x >= 0 && z >= 0 && x < SIZE && z < SIZE;
  if (!inside) {
    if (L === 0) out.push({ x0: x, y0: -SLAB, z0: z, x1: x + 1, y1: 0, z1: z + 1 });
    return;
  }
  const c = LEVEL_GRIDS[L][z][x];
  if (c !== 'o') out.push({ x0: x, y0: base - SLAB, z0: z, x1: x + 1, y1: base, z1: z + 1 });
  if (L === LEVELS - 1 && c === '#') return;
  switch (c) {
    case '#': out.push({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 }); break;
    case 'w':
      out.push({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + WIN_LO, z1: z + 1 });
      out.push({ x0: x, y0: base + WIN_HI, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 });
      break;
    case 'D': {
      out.push({ x0: x, y0: base + DOOR_H, z0: z, x1: x + 1, y1: base + WALL_H, z1: z + 1 });
      const d = doorAtCell(L, x, z);
      if (d && !doorOpen(d.id)) {
        const b = doorBox(d);
        // clip to this cell
        out.push({ x0: Math.max(b.x0, x), y0: b.y0, z0: Math.max(b.z0, z), x1: Math.min(b.x1, x + 1), y1: b.y1, z1: Math.min(b.z1, z + 1) });
      }
      break;
    }
    case 'r': out.push({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + RAIL_H, z1: z + 1 }); break;
    case 'b': out.push({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + PAD_H, z1: z + 1, bounce: BOUNCE_SMALL }); break;
    case 'B': out.push({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + PAD_H, z1: z + 1, bounce: BOUNCE_BIG }); break;
    default:
      if (isStair(c)) out.push({ x0: x, y0: base, z0: z, x1: x + 1, y1: base + stairH(c), z1: z + 1 });
  }
}

/** All solid boxes overlapping the given AABB region */
export function boxesIn(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, doorOpen: (id: string) => boolean): Box[] {
  const out: Box[] = [];
  const L0 = Math.max(0, Math.floor((y0 + SLAB) / FLOOR_H) - 1);
  const L1 = Math.min(LEVELS - 1, Math.floor((y1 + SLAB) / FLOOR_H));
  for (let L = L0; L <= L1; L++)
    for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) cellBoxes(L, x, z, out, doorOpen);
  for (const b of STATIC_BOXES) if (b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1 && b.z1 > z0 && b.z0 < z1) out.push(b);
  return out;
}

// ---------- Drawable panels ----------
export type Dir = 'px' | 'nx' | 'pz' | 'nz';
export interface Panel {
  id: string;
  level: number;
  dir: Dir;
  // world-space origin (u=0,v=0), u axis unit vector, normal
  ox: number; oy: number; oz: number;
  ux: number; uz: number;
  nx: number; nz: number;
  w: number; h: number;
}

const solidWall = (c: string | null) => c === '#';
const openCell = (c: string | null) => c === null || !'#wD'.includes(c);

export const PANELS: Panel[] = (() => {
  const out: Panel[] = [];
  for (let L = 0; L < LEVELS - 1; L++) {
    const y = L * FLOOR_H;
    // faces normal to z
    for (const nz of [1, -1]) {
      for (let z = 0; z < SIZE; z++) {
        let run = -1;
        for (let x = 0; x <= SIZE; x++) {
          const ok = x < SIZE && solidWall(cellAt(L, x, z)) && openCell(cellAt(L, x, z + nz));
          if (ok && run < 0) run = x;
          if (!ok && run >= 0) {
            const fz = nz > 0 ? z + 1 : z;
            const w = x - run;
            // u axis: +z normal -> +x ; -z normal -> -x
            const ux = nz > 0 ? 1 : -1;
            out.push({ id: `${L}${nz > 0 ? 'pz' : 'nz'}${z}.${run}`, level: L, dir: nz > 0 ? 'pz' : 'nz', ox: ux > 0 ? run : x, oy: y, oz: fz, ux, uz: 0, nx: 0, nz, w, h: WALL_H });
            run = -1;
          }
        }
      }
    }
    for (const nx of [1, -1]) {
      for (let x = 0; x < SIZE; x++) {
        let run = -1;
        for (let z = 0; z <= SIZE; z++) {
          const ok = z < SIZE && solidWall(cellAt(L, x, z)) && openCell(cellAt(L, x + nx, z));
          if (ok && run < 0) run = z;
          if (!ok && run >= 0) {
            const fx = nx > 0 ? x + 1 : x;
            const w = z - run;
            // +x normal -> u = -z ; -x normal -> u = +z
            const uz = nx > 0 ? -1 : 1;
            out.push({ id: `${L}${nx > 0 ? 'px' : 'nx'}${x}.${run}`, level: L, dir: nx > 0 ? 'px' : 'nx', ox: fx, oy: y, oz: uz > 0 ? run : z, ux: 0, uz, nx, nz: 0, w, h: WALL_H });
            run = -1;
          }
        }
      }
    }
  }
  return out;
})();
export const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));

/** Ray (origin o, normalized dir d) vs panels. Returns nearest hit within maxDist. */
export function raycastPanels(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number) {
  let best: { panel: Panel; t: number; u: number; v: number } | null = null;
  for (const p of PANELS) {
    const denom = dx * p.nx + dz * p.nz;
    if (denom >= -1e-6) continue; // must face the ray
    const t = ((p.ox - ox) * p.nx + (p.oz - oz) * p.nz) / denom;
    if (t < 0 || t > maxDist || (best && t >= best.t)) continue;
    const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
    const u = (hx - p.ox) * p.ux + (hz - p.oz) * p.uz;
    const v = hy - p.oy;
    if (u < 0 || u > p.w || v < 0 || v > p.h) continue;
    best = { panel: p, t, u, v };
  }
  return best;
}

/** Ray vs solid geometry via sampling (cheap, coarse). Returns distance to first solid or Infinity */
export function raycastSolid(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, doorOpen: (id: string) => boolean) {
  const step = 0.05;
  for (let t = 0.2; t < maxDist; t += step) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const bs = boxesIn(x, y, z, x, y, z, doorOpen);
    for (const b of bs) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return t;
  }
  return Infinity;
}

// ---------- Rooms (regions) ----------
export interface Room { id: number; level: number; name: string; cells: number; cx: number; cz: number }
export const ROOMS: Room[] = [];
export const ROOM_GRID: Int16Array[] = []; // per level, SIZE*SIZE, -1 = none

(() => {
  const names: Record<string, string> = {
    '0,0': 'северо-западная', '1,0': 'северный зал', '2,0': 'северо-восточная',
    '0,1': 'западный зал', '1,1': 'атриум', '2,1': 'восточный зал',
    '0,2': 'юго-западная', '1,2': 'южный зал', '2,2': 'юго-восточная',
  };
  const floors = ['цоколь', 'второй этаж', 'третий этаж', 'крыша'];
  for (let L = 0; L < LEVELS; L++) {
    const grid = new Int16Array(SIZE * SIZE).fill(-1);
    ROOM_GRID.push(grid);
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      if (grid[z * SIZE + x] >= 0) continue;
      const c = LEVEL_GRIDS[L][z][x];
      if ('#wD'.includes(c)) continue;
      const id = ROOMS.length;
      const stack = [x, z];
      let n = 0, sx = 0, sz = 0;
      grid[z * SIZE + x] = id;
      while (stack.length) {
        const cz = stack.pop()!, cx = stack.pop()!;
        n++; sx += cx; sz += cz;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ax, nz = cz + az;
          if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
          if (grid[nz * SIZE + nx] >= 0) continue;
          if ('#wD'.includes(LEVEL_GRIDS[L][nz][nx])) continue;
          grid[nz * SIZE + nx] = id;
          stack.push(nx, nz);
        }
      }
      const cx = sx / n, cz = sz / n;
      const bx = cx < 11 ? 0 : cx < 29 ? 1 : 2;
      const bz = cz < 11 ? 0 : cz < 29 ? 1 : 2;
      const nm = L === LEVELS - 1 ? 'крыша' : `${names[bx + ',' + bz]} · ${floors[L]}`;
      ROOMS.push({ id, level: L, name: nm, cells: n, cx, cz });
    }
  }
})();
export const OUTSIDE_ROOM = -1;

export function levelOfY(y: number) {
  return Math.max(0, Math.min(LEVELS - 1, Math.floor((y + 0.3) / FLOOR_H)));
}
export function roomAt(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix < 0 || iz < 0 || ix >= SIZE || iz >= SIZE) return OUTSIDE_ROOM;
  const L = levelOfY(y);
  return ROOM_GRID[L][iz * SIZE + ix];
}

export function spawnPoint(seed: number) {
  const spots = [[17, 18], [23, 22], [18, 23], [22, 17], [16, 20], [25, 20]];
  const s = spots[Math.abs(seed) % spots.length];
  return { x: s[0] + 0.5, y: 0.01, z: s[1] + 0.5 };
}
