import * as THREE from 'three';
import './style.css';
import { DOORS, ROOMS, levelOfY, raycastPanels, raycastSolid, roomAt } from '../../shared/world';
import { F_CROUCH, F_DRAWING, F_MOVING, MAX_SIZE, MIN_SIZE, MAX_STROKE_NUMS, type PlayerInfo, type ServerMsg, type StrokeData } from '../../shared/protocol';
import { buildSky, buildWorld, updateDoors } from './world3d';
import { Player, type InputState } from './player';
import { PaintLayer } from './paint';
import { Avatar } from './avatars';
import { Music } from './music';
import { Visualizer } from './viz';
import { Net } from './net';
import { mushroomFace } from './textures';

// ------------------------------------------------------------------ config
const API = (import.meta.env.VITE_SERVER as string | undefined) || `http://${location.hostname}:8787`;
const WS = API.replace(/^http/, 'ws');
const REACH = 7;
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
if (IS_TOUCH) document.body.classList.add('touch');

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get: (k: string) => { try { return localStorage.getItem('ez.' + k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem('ez.' + k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem('ez.' + k); } catch { /* */ } },
};

// ------------------------------------------------------------------ identity / login
interface Identity { token?: string; gid?: string; name?: string }

declare global {
  interface Window {
    onTelegramAuth?: (u: Record<string, unknown>) => void;
    Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void } };
  }
}

async function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}

async function getIdentity(): Promise<Identity> {
  // 1) inside Telegram Mini App
  if (location.hash.includes('tgWebAppData')) {
    try {
      await loadScript('https://telegram.org/js/telegram-web-app.js');
      const wa = window.Telegram?.WebApp;
      if (wa?.initData) {
        wa.ready(); wa.expand();
        const r = await fetch(`${API}/api/auth/webapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: wa.initData }) });
        if (r.ok) { const { token } = await r.json(); store.set('token', token); return { token }; }
      }
    } catch (e) { console.warn(e); }
  }
  // 2) saved session
  const token = store.get('token');
  if (token) return { token };
  const gname = store.get('guestName');
  if (gname && store.get('gid')) return { gid: store.get('gid')!, name: gname };

  // 3) show login
  return new Promise((resolve) => {
    $('login').classList.remove('hidden');
    const nameInput = $<HTMLInputElement>('guest-name');
    nameInput.value = store.get('guestName') || '';
    const goGuest = () => {
      const name = nameInput.value.trim() || 'спора-' + Math.floor(Math.random() * 999);
      let gid = store.get('gid');
      if (!gid) { gid = Math.random().toString(36).slice(2, 12); store.set('gid', gid); }
      store.set('guestName', name);
      $('login').classList.add('hidden');
      resolve({ gid, name });
    };
    $('guest-go').onclick = goGuest;
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') goGuest(); };

    fetch(`${API}/api/config`).then((r) => r.json()).then((cfg: { bot: string | null }) => {
      if (!cfg.bot) { $('tg-note').textContent = 'вход через Telegram скоро появится'; return; }
      window.onTelegramAuth = async (user) => {
        const r = await fetch(`${API}/api/auth/telegram`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(user) });
        if (!r.ok) { $('tg-note').textContent = 'не получилось войти через Telegram'; return; }
        const { token } = await r.json();
        store.set('token', token);
        $('login').classList.add('hidden');
        resolve({ token });
      };
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.setAttribute('data-telegram-login', cfg.bot);
      s.setAttribute('data-size', 'large');
      s.setAttribute('data-radius', '9');
      s.setAttribute('data-onauth', 'onTelegramAuth(user)');
      s.setAttribute('data-request-access', 'write');
      $('tg-login').appendChild(s);
    }).catch(() => { $('tg-note').textContent = 'сервер спит… попробуй гостем'; });
  });
}

// ------------------------------------------------------------------ three setup
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color('#6a4a86');
scene.fog = new THREE.Fog(FOG, 30, 140);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0xe4ddf0, 0xa69a8e, 1.5) /* sky: dusk; ground: bounce light, slightly warm from oak floors but mostly neutral (concrete, plaster) */);
const sun = new THREE.DirectionalLight(0xffe2c8, 1.1);
sun.position.set(30, 60, 10);
scene.add(sun);

const world = buildWorld(scene);
const sky = buildSky(scene);
const paint = new PaintLayer(scene);
const music = new Music();
new Visualizer(scene, (b) => music.spectrum(b), () => music.level);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ state
const doorOpen = new Map<string, boolean>(DOORS.map((d) => [d.id, true]));
const isDoorOpen = (id: string) => doorOpen.get(id) ?? true;
const player = new Player(isDoorOpen, Math.floor(Math.random() * 100));
const avatars = new Map<string, Avatar>();
let me: PlayerInfo | null = null;
const panelCounts: Record<string, number> = {};
let net: Net | null = null;

// tools
const PALETTE = [0x1a1c2c, 0x5d275d, 0xb13e53, 0xef7d57, 0xffcd75, 0xa7f070, 0x38b764, 0x257179, 0x29366f, 0x3b5dc9, 0x41a6f6, 0x73eff7, 0xf4f4f4, 0x94b0c2, 0x566c86, 0xff77a8, 0xd64646];
const TOOL_NAMES = ['кисть', 'маркер', 'спрей', 'пиксель', 'споры'];
let tool = Number(store.get('tool') ?? 0);
let color = Number(store.get('color') ?? 0xff77a8);
let size = Number(store.get('size') ?? 12);

// ------------------------------------------------------------------ input
const keys = new Set<string>();
const inp: InputState = { fwd: 0, right: 0, jump: false, crouch: false };
let locked = false;
let mouseDown = false;
let touchDraw = false; // draw-mode toggle on touch
let touchDrawPoint: { x: number; y: number } | null = null;
let crouchToggle = false;
let started = false;

function setLocked(v: boolean) {
  locked = v;
  if (!IS_TOUCH) $('pause').classList.toggle('hidden', v || !started);
}
document.addEventListener('pointerlockchange', () => setLocked(document.pointerLockElement === renderer.domElement));
$('pause').addEventListener('click', () => renderer.domElement.requestPointerLock());
renderer.domElement.addEventListener('click', () => { if (!IS_TOUCH && !locked && started) renderer.domElement.requestPointerLock(); });

addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0022));
});
addEventListener('mousedown', (e) => { if (locked && e.button === 0) mouseDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; } });
addEventListener('wheel', (e) => { if (locked) setSize(size + (e.deltaY < 0 ? 2 : -2)); }, { passive: true });

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Tab') { e.preventDefault(); if (locked) document.exitPointerLock(); }
  if (e.code === 'KeyE') toggleNearestDoor();
  if (e.code === 'KeyM') toggleMusic();
  if (e.code === 'KeyH') { if (locked) document.exitPointerLock(); }
  if (e.code >= 'Digit1' && e.code <= 'Digit5') setTool(Number(e.code.slice(5)) - 1);
  if (e.code === 'BracketRight') setSize(size + 2);
  if (e.code === 'BracketLeft') setSize(size - 2);
  if (e.code === 'KeyQ' || e.code === 'KeyR') {
    const i = PALETTE.indexOf(color);
    setColor(PALETTE[(i + (e.code === 'KeyR' ? 1 : -1) + PALETTE.length) % PALETTE.length]);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseDown = false; });

// ---- touch controls
const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
const look = { id: -1, x: 0, y: 0 };
let touchJump = false;
if (IS_TOUCH) {
  $('touch').classList.remove('hidden');
  const zone = $('stick-zone'), base = $('stick-base'), knob = $('stick-knob');
  zone.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    stick.id = t.identifier; stick.ox = t.clientX; stick.oy = t.clientY; stick.x = stick.y = 0;
    base.style.left = t.clientX - 55 + 'px'; base.style.top = t.clientY - 55 + 'px'; base.style.bottom = 'auto';
    e.preventDefault();
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stick.id) {
      let dx = t.clientX - stick.ox, dy = t.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > 50) { dx *= 50 / d; dy *= 50 / d; }
      stick.x = dx / 50; stick.y = dy / 50;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    e.preventDefault();
  }, { passive: false });
  const endStick = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stick.id) {
      stick.id = -1; stick.x = stick.y = 0; knob.style.transform = '';
    }
  };
  zone.addEventListener('touchend', endStick);
  zone.addEventListener('touchcancel', endStick);

  const cv = renderer.domElement;
  cv.addEventListener('touchstart', (e) => {
    for (const t of Array.from(e.changedTouches)) {
      if (look.id !== -1) continue;
      look.id = t.identifier; look.x = t.clientX; look.y = t.clientY;
      if (touchDraw) touchDrawPoint = { x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  }, { passive: false });
  cv.addEventListener('touchmove', (e) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === look.id) {
      if (touchDraw) touchDrawPoint = { x: t.clientX, y: t.clientY };
      else {
        player.yaw -= (t.clientX - look.x) * 0.006;
        player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - (t.clientY - look.y) * 0.006));
      }
      look.x = t.clientX; look.y = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  const endLook = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === look.id) { look.id = -1; touchDrawPoint = null; }
  };
  cv.addEventListener('touchend', endLook);
  cv.addEventListener('touchcancel', endLook);

  const hold = (id: string, on: (v: boolean) => void) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { on(true); e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('touchend', (e) => { on(false); e.preventDefault(); });
  };
  hold('t-jump', (v) => { touchJump = v; });
  hold('t-crouch', (v) => { if (v) { crouchToggle = !crouchToggle; $('t-crouch').classList.toggle('on', crouchToggle); } });
  hold('t-door', (v) => { if (v) toggleNearestDoor(); });
  hold('t-draw', (v) => {
    if (!v) return;
    touchDraw = !touchDraw;
    $('t-draw').classList.toggle('on', touchDraw);
    flushChunk(true);
  });
}

function readInput() {
  const k = (c: string) => keys.has(c);
  inp.fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  inp.right = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  inp.jump = k('Space') || touchJump;
  inp.crouch = k('ShiftLeft') || k('ShiftRight') || k('KeyC') || k('ControlLeft') || crouchToggle;
  if (stick.id !== -1) { inp.fwd = -stick.y; inp.right = stick.x; }
  if (!locked && !IS_TOUCH) { inp.fwd = inp.right = 0; inp.jump = false; }
}

// ------------------------------------------------------------------ toolbar UI
function toolIcon(t: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 11;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  const P = (a: number, b: number, w = 1, h = 1) => x.fillRect(a, b, w, h);
  if (t === 0) { P(7, 1, 3, 3); P(5, 3, 3, 3); P(3, 5, 3, 3); x.fillStyle = '#ffd88a'; P(1, 8, 2, 2); }
  if (t === 1) { P(6, 1, 4, 4); P(4, 3, 4, 4); P(2, 5, 4, 3); x.fillStyle = '#ffd88a'; P(1, 8, 4, 2); }
  if (t === 2) { P(4, 4, 4, 6); P(5, 2, 2, 2); x.fillStyle = '#ffd88a'; P(1, 1); P(2, 3); P(0, 4); P(3, 0); }
  if (t === 3) { P(1, 1, 4, 4); P(6, 6, 4, 4); x.fillStyle = '#ffd88a'; P(6, 1, 4, 4); P(1, 6, 4, 4); }
  if (t === 4) { x.fillStyle = '#ffd88a'; P(4, 4, 3, 3); x.fillStyle = '#fff'; P(1, 2); P(8, 1); P(9, 8); P(2, 9); P(5, 0); P(0, 6); P(10, 5); }
  return c;
}
function buildToolbar() {
  const tools = $('tools');
  TOOL_NAMES.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'tool'; b.title = `${n} (${i + 1})`;
    b.appendChild(toolIcon(i));
    const k = document.createElement('span'); k.className = 'k'; k.textContent = String(i + 1);
    b.appendChild(k);
    b.onclick = () => setTool(i);
    tools.appendChild(b);
  });
  const pal = $('palette');
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'sw';
    b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.dataset.c = String(c);
    b.onclick = () => setColor(c);
    pal.appendChild(b);
  }
  const cu = document.createElement('label');
  cu.className = 'sw custom'; cu.title = 'любой цвет';
  const ci = document.createElement('input'); ci.type = 'color';
  ci.oninput = () => setColor(parseInt(ci.value.slice(1), 16));
  cu.appendChild(ci);
  pal.appendChild(cu);
  const sz = $<HTMLInputElement>('size');
  sz.min = String(MIN_SIZE); sz.max = String(MAX_SIZE);
  sz.oninput = () => setSize(Number(sz.value));
  // keep toolbar clicks from re-locking / drawing
  $('toolbar').addEventListener('mousedown', (e) => e.stopPropagation());
  setTool(tool); setColor(color); setSize(size);
  if (IS_TOUCH) {
    // compact toolbar on phones: palette opens from the colour dot
    pal.classList.add('hidden');
    $('size-dot').addEventListener('click', () => pal.classList.toggle('hidden'));
    pal.addEventListener('click', (e) => { if ((e.target as HTMLElement).classList.contains('sw') && !(e.target as HTMLElement).classList.contains('custom')) pal.classList.add('hidden'); });
  }
}
function setTool(t: number) {
  tool = Math.max(0, Math.min(4, t)); store.set('tool', String(tool));
  document.querySelectorAll('.tool').forEach((el, i) => el.classList.toggle('on', i === tool));
  flushChunk(true);
}
function setColor(c: number) {
  color = c; store.set('color', String(c));
  const hex = '#' + c.toString(16).padStart(6, '0');
  document.querySelectorAll<HTMLElement>('.sw').forEach((el) => el.classList.toggle('on', Number(el.dataset.c) === c));
  $('size-dot').style.background = hex;
  ringMat.color.set(c);
  flushChunk(true);
}
function setSize(s: number) {
  size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(s))); store.set('size', String(size));
  $<HTMLInputElement>('size').value = String(size);
  $('size-label').textContent = String(size);
  const d = 6 + (size / MAX_SIZE) * 12;
  $('size-dot').style.width = $('size-dot').style.height = d + 'px';
  flushChunk(true);
}

// brush preview ring on the wall
const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, fog: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), ringMat);
ring.renderOrder = 10;
ring.visible = false;
scene.add(ring);

// ------------------------------------------------------------------ HUD: players & feed
function avatarThumb(info: PlayerInfo) {
  if (info.photo) {
    const img = document.createElement('img');
    img.src = `${API}/api/avatar?u=${encodeURIComponent(info.photo)}`;
    img.crossOrigin = 'anonymous';
    return img;
  }
  return mushroomFace(info.uid);
}
function renderPlayers() {
  const n = avatars.size + (me ? 1 : 0);
  $('online-n').textContent = String(n);
  $('online-word').textContent = plural(n, 'живой', 'живых', 'живых');
  const box = $('players');
  box.innerHTML = '';
  const add = (info: PlayerInfo, you = false) => {
    const row = document.createElement('div'); row.className = 'pl';
    row.appendChild(avatarThumb(info));
    const nm = document.createElement('span'); nm.textContent = info.name; row.appendChild(nm);
    if (you) { const y = document.createElement('span'); y.className = 'you'; y.textContent = '(ты)'; row.appendChild(y); }
    box.appendChild(row);
  };
  if (me) add(me, true);
  for (const a of avatars.values()) add(a.info);
}
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
$('online').onclick = () => $('players').classList.toggle('hidden');
function feed(text: string) {
  const el = document.createElement('div');
  el.className = 'ev'; el.textContent = text;
  const f = $('feed');
  f.appendChild(el);
  while (f.children.length > 5) f.firstChild!.remove();
  setTimeout(() => el.classList.add('out'), 6000);
  setTimeout(() => el.remove(), 7300);
}

// ------------------------------------------------------------------ music toggle
async function toggleMusic(force?: boolean) {
  const on = force ?? !music.enabled;
  if (on) await music.start(); else music.stop();
  store.set('music', on ? '1' : '0');
  $('btn-music').classList.toggle('on', on);
  $('btn-music').querySelector('span')!.textContent = on ? 'вкл' : 'выкл';
}
$('btn-music').onclick = () => toggleMusic();
$('btn-help').onclick = () => { if (IS_TOUCH) alert('Левый круг — идти. Свайп справа — смотреть.\n✎ — режим рисования: води пальцем по стене.\n▲ прыжок · ▾ присесть · ⌂ дверь.\nРисовать можно. Стирать — нельзя.'); else $('pause').classList.remove('hidden'); };
$('logout').onclick = (e) => { e.stopPropagation(); store.del('token'); store.del('guestName'); location.reload(); };

// ------------------------------------------------------------------ doors
function toggleNearestDoor() {
  const L = levelOfY(player.y);
  let best: string | null = null, bd = 3.2;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const d of DOORS) {
    if (d.level !== L) continue;
    const cx = d.axis === 'x' ? d.x0 + d.len / 2 : d.x0 + 0.5;
    const cz = d.axis === 'z' ? d.z0 + d.len / 2 : d.z0 + 0.5;
    const dx = cx - player.x, dz = cz - player.z;
    const dist = Math.hypot(dx, dz);
    const facing = (dx * fx + dz * fz) / (dist || 1);
    const score = dist - facing * 0.8;
    if (dist < 3.2 && score < bd) { bd = score; best = d.id; }
  }
  if (best) net?.send({ t: 'door', id: best });
}
function applyDoor(id: string, open: boolean) {
  doorOpen.set(id, open);
  const v = world.doors.get(id);
  if (v) v.target = open ? Math.PI / 2 : 0;
}

// ------------------------------------------------------------------ drawing
interface Chunk { panel: string; seed: number; pts: number[]; t0: number; lastAdd: number; cont?: boolean }
let chunk: Chunk | null = null;
const tmpDir = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function aimRay(screen: { x: number; y: number } | null) {
  if (screen) {
    raycaster.setFromCamera(new THREE.Vector2((screen.x / innerWidth) * 2 - 1, -(screen.y / innerHeight) * 2 + 1), camera);
    tmpDir.copy(raycaster.ray.direction);
  } else camera.getWorldDirection(tmpDir);
  const o = camera.position;
  const hit = raycastPanels(o.x, o.y, o.z, tmpDir.x, tmpDir.y, tmpDir.z, REACH);
  if (!hit) return null;
  const solid = raycastSolid(o.x, o.y, o.z, tmpDir.x, tmpDir.y, tmpDir.z, hit.t + 0.1, isDoorOpen);
  if (solid < hit.t - 0.08) return null;
  return hit;
}

function flushChunk(end = false) {
  if (!chunk) return;
  const c = chunk;
  if (c.cont && c.pts.length === 2) { chunk = null; return; }
  if (c.pts.length === 2) {
    // single dot
    paint.segment(c.panel, tool, color, size, c.seed, 0, c.pts[0], c.pts[1], c.pts[0], c.pts[1]);
  }
  if (c.pts.length >= 2) {
    const d: StrokeData = [tool, color, size, c.seed, c.pts];
    net?.send({ t: 's', p: c.panel, d });
    panelCounts[c.panel] = (panelCounts[c.panel] || 0) + 1;
  }
  chunk = null;
  if (!end && c.pts.length >= 2) {
    // continue the line in a new chunk starting from the last point
    const n = c.pts.length;
    chunk = { panel: c.panel, seed: (Math.random() * 2 ** 31) | 0, pts: [c.pts[n - 2], c.pts[n - 1]], t0: performance.now(), lastAdd: performance.now(), cont: true };
  }
}

function updateDrawing() {
  const active = IS_TOUCH ? touchDraw : locked;
  const wantDraw = IS_TOUCH ? touchDraw && touchDrawPoint !== null : locked && mouseDown;
  const hit = active ? aimRay(IS_TOUCH ? touchDrawPoint : null) : null;
  // preview ring
  if (hit && (!IS_TOUCH || touchDrawPoint)) {
    const p = hit.panel;
    ring.visible = true;
    ring.position.set(p.ox + p.ux * hit.u + p.nx * 0.02, p.oy + hit.v, p.oz + p.uz * hit.u + p.nz * 0.02);
    ring.rotation.set(0, Math.atan2(p.nx, p.nz), 0);
    const s = Math.max(0.03, size / 100);
    ring.scale.setScalar(s);
  } else ring.visible = false;

  if (!wantDraw || !hit) { if (chunk) flushChunk(true); return; }
  const u = Math.round(hit.u * 100), v = Math.round(hit.v * 100);
  const now = performance.now();
  if (chunk && chunk.panel !== hit.panel.id) flushChunk(true);
  if (!chunk) {
    chunk = { panel: hit.panel.id, seed: (Math.random() * 2 ** 31) | 0, pts: [u, v], t0: now, lastAdd: now };
    return;
  }
  const n = chunk.pts.length;
  const lu = chunk.pts[n - 2], lv = chunk.pts[n - 1];
  const dist = Math.hypot(u - lu, v - lv);
  const minStep = Math.max(1.5, size * 0.18);
  const sprayHold = (tool === 2 || tool === 4) && now - chunk.lastAdd > 70;
  if (dist >= minStep || sprayHold) {
    chunk.pts.push(u, v);
    chunk.lastAdd = now;
    const i = chunk.pts.length / 2 - 2;
    paint.segment(chunk.panel, tool, color, size, chunk.seed, i, lu, lv, u, v);
  }
  if (chunk.pts.length >= MAX_STROKE_NUMS - 2 || (now - chunk.t0 > 120 && chunk.pts.length >= 4)) flushChunk(false);
}

// ------------------------------------------------------------------ network
function onMsg(m: ServerMsg) {
  switch (m.t) {
    case 'welcome': {
      me = m.you;
      for (const a of avatars.values()) { scene.remove(a.root); a.dispose(); }
      avatars.clear();
      for (const p of m.players) addAvatar(p);
      for (const s of m.states) avatars.get(s[0])?.push(s);
      for (const [id, open] of Object.entries(m.doors)) applyDoor(id, open);
      Object.assign(panelCounts, m.panels);
      paint.loadAll(API, m.panels, { x: player.x, y: player.y, z: player.z });
      renderPlayers();
      $('conn').classList.add('hidden');
      lastSend = 0;
      break;
    }
    case 'join':
      addAvatar(m.p);
      renderPlayers();
      feed(`✦ ${m.p.name} прорастает`);
      music.event('join');
      break;
    case 'leave': {
      const a = avatars.get(m.id);
      if (a) {
        scene.remove(a.root); a.dispose(); avatars.delete(m.id);
        feed(`✧ ${a.info.name} растворяется`);
        music.event('leave');
      }
      renderPlayers();
      break;
    }
    case 'ps':
      for (const s of m.d) if (s[0] !== me?.id) avatars.get(s[0])?.push(s);
      break;
    case 's': {
      const had = (panelCounts[m.p] || 0) > 0;
      paint.remote(m.p, m.d, had);
      panelCounts[m.p] = (panelCounts[m.p] || 0) + 1;
      break;
    }
    case 'door':
      applyDoor(m.id, m.open);
      break;
  }
}
function addAvatar(p: PlayerInfo) {
  if (avatars.has(p.id) || p.id === me?.id) return;
  const a = new Avatar(p, API);
  avatars.set(p.id, a);
  scene.add(a.root);
}

let lastSend = 0;
let lastSent = '';
function sendState(now: number) {
  if (!net || now - lastSend < 125) return;
  const flags = (player.crouching ? F_CROUCH : 0) | (player.moving ? F_MOVING : 0) | (chunk ? F_DRAWING : 0);
  const s: [number, number, number, number, number, number] = [player.x, player.y, player.z, player.yaw, player.pitch, flags];
  const key = s.map((n) => n.toFixed(2)).join(',');
  if (key === lastSent && now - lastSend < 4000) return;
  lastSent = key; lastSend = now;
  net.send({ t: 'p', s });
}

// ------------------------------------------------------------------ music field
let lastField = 0;
let currentRoom = -2;
function updateField(now: number) {
  if (now - lastField < 250) return;
  lastField = now;
  const myRoom = roomAt(player.x, player.y + 0.5, player.z);
  if (myRoom !== currentRoom) {
    currentRoom = myRoom;
    $('room-name').textContent = myRoom < 0 ? 'луг' : ROOMS[myRoom].name;
  }
  let prox = 0, movingNear = 0;
  const voices: { tone: number; pan: number; gain: number; moving: boolean; d: number }[] = [];
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const a of avatars.values()) {
    if (!a.hasState) continue;
    const dx = a.x - player.x, dy = a.y - player.y, dz = a.z - player.z;
    const d = Math.hypot(dx, dy, dz);
    const same = roomAt(a.x, a.y + 0.5, a.z) === myRoom;
    const w = Math.exp(-d / 7) * (same ? 1 : 0.45);
    prox += w;
    const mv = !!(a.flags & (F_MOVING | F_DRAWING));
    if (mv) movingNear += w;
    if (d < 28) {
      // pan: project onto right vector
      const rx = -fz, rz = fx;
      const pan = (dx * rx + dz * rz) / (Math.hypot(dx, dz) || 1);
      voices.push({ tone: a.personal % 997, pan, gain: Math.exp(-d / 10) * (same ? 1 : 0.6), moving: mv, d });
    }
  }
  voices.sort((a, b) => a.d - b.d);
  const online = avatars.size + 1;
  const crowd = Math.log2(1 + online) / Math.log2(1 + 40);
  const I = 0.55 * (1 - Math.exp(-prox / 1.3)) + 0.2 * Math.min(1, movingNear) + 0.1 * (player.moving ? 1 : 0) + 0.15 * Math.min(1, crowd);
  music.setField({ intensity: Math.max(0, Math.min(1, I)), room: myRoom, level: levelOfY(player.y), voices: voices.slice(0, 6), online });
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let bouncedSeen = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  readInput();
  player.update(dt, inp);
  if (player.bounced !== bouncedSeen) { bouncedSeen = player.bounced; music.event('bounce'); }
  camera.position.set(player.x, player.eyeSmoothY, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  sky.sky.position.copy(camera.position);
  sky.stars.position.copy(camera.position);
  updateDoors(world.doors, dt);
  for (const a of avatars.values()) a.update(dt, camera.position);
  if (started) {
    updateDrawing();
    sendState(now);
    updateField(now);
  }
  paint.flush();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
buildToolbar();
requestAnimationFrame(frame);
camera.position.set(20, 8, 44);

(async () => {
  const id = await getIdentity();
  const q = new URLSearchParams();
  if (id.token) q.set('token', id.token);
  else { q.set('gid', id.gid!); q.set('name', id.name!); }
  net = new Net(`${WS}/ws?${q}`);
  net.onMsg = onMsg;
  net.onStatus = (s) => {
    $('conn').classList.toggle('hidden', s === 'open');
    if (s === 'closed') $('conn').textContent = 'соединение потеряно… переподключаюсь';
  };
  $('conn').classList.remove('hidden');
  net.connect();
  started = true;
  if (!IS_TOUCH) $('pause').classList.remove('hidden');
  // music: remembered choice, but browsers need a gesture to start audio
  if (store.get('music') === '1') {
    const kick = () => { toggleMusic(true); removeEventListener('pointerdown', kick); removeEventListener('keydown', kick); };
    addEventListener('pointerdown', kick);
    addEventListener('keydown', kick);
  }
})();

// debug / automated testing hook
(window as unknown as { __ez: unknown }).__ez = {
  player, camera, avatars, paint, music, doorOpen,
  setLocked: (v: boolean) => setLocked(v),
  setMouse: (v: boolean) => { mouseDown = v; },
  toggleNearestDoor, setTool, setColor, setSize,
};
