import * as THREE from 'three';
import './style.css';
import qrcode from 'qrcode-generator';
import { Mirrors } from './mirrors';
import { Sfx, surfaceAt } from './sfx';
import { CENTER, DOORS, FLOOR_H, ROOMS, SEG_H, SLAB, hardness, insideMirror, islandEdge, levelOfY, parseKey, raycastBlock, raycastPanels, raycastSolid, roomAt, type WorldState } from '../../shared/world';
import { F_CROUCH, F_DRAWING, F_MOVING, MAX_SIZE, MIN_SIZE, MAX_STROKE_NUMS, type PlayerInfo, type ServerMsg, type StrokeData } from '../../shared/protocol';
import { buildCilia, buildVoid, buildWorld, updateDoors } from './world3d';
import { Sky } from './sky';
import { LIFE, MAX_PEOPLE, heartbeat } from './living';
import { Player, type InputState } from './player';
import { PaintLayer } from './paint';
import { Avatar, avatarUrl } from './avatars';
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
// Login is Telegram-only. Desktop: QR code (scan with the phone camera). Mobile: a button that jumps
// straight into the Telegram app. The bot receives /start login_<code>, the page polls until confirmed.

declare global {
  interface Window {
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

function drawQR(canvas: HTMLCanvasElement, text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const cell = Math.floor(canvas.width / (n + quiet * 2));
  const off = Math.floor((canvas.width - cell * n) / 2);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff4e6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1a1238';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
}

let isNewLogin = false;

async function getToken(): Promise<string> {
  // 1) inside Telegram Mini App: automatic
  if (location.hash.includes('tgWebAppData')) {
    try {
      await loadScript('https://telegram.org/js/telegram-web-app.js');
      const wa = window.Telegram?.WebApp;
      if (wa?.initData) {
        wa.ready(); wa.expand();
        const r = await fetch(`${API}/api/auth/webapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: wa.initData }) });
        if (r.ok) { const { token } = await r.json(); store.set('token', token); if (!store.get('named')) isNewLogin = true; return token; }
      }
    } catch (e) { console.warn(e); }
  }
  // 2) saved session
  const saved = store.get('token');
  if (saved) {
    try {
      const r = await fetch(`${API}/api/me?token=${encodeURIComponent(saved)}`);
      if (r.ok) return saved;
      if (r.status === 401) store.del('token');
    } catch {
      // server unreachable: do not let anyone in offline
      $('login').classList.remove('hidden');
      $('login-status').textContent = 'сервер недоступен, обнови страницу позже';
      return new Promise<string>(() => {});
    }
  }

  // 3) bot login
  $('login').classList.remove('hidden');
  $(IS_TOUCH ? 'login-mobile' : 'login-desktop').classList.remove('hidden');
  const status = $('login-status');
  return new Promise((resolve) => {
    let code = '';
    let started = 0;
    const fresh = async () => {
      status.textContent = '';
      try {
        const r = await fetch(`${API}/api/login/start`, { method: 'POST' });
        const d = (await r.json()) as { code: string; url: string; tg: string };
        code = d.code; started = Date.now();
        if (IS_TOUCH) {
          const a = $<HTMLAnchorElement>('tg-mobile');
          a.href = d.tg;
          a.onclick = () => {
            // no Telegram app installed -> fall back to the web link after a moment
            const t = setTimeout(() => { if (!document.hidden) location.href = d.url; }, 1500);
            addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
          };
        } else {
          drawQR($<HTMLCanvasElement>('tg-qr'), d.url);
          $<HTMLAnchorElement>('tg-desktop-link').href = d.url;
        }
      } catch {
        status.textContent = 'сервер не отвечает, пробую ещё раз…';
        setTimeout(fresh, 3000);
      }
    };
    const poll = async () => {
      if (!code) return;
      if (Date.now() - started > 9 * 60 * 1000) { await fresh(); return; }
      try {
        const r = await fetch(`${API}/api/login/poll?code=${code}`);
        const d = (await r.json()) as { status: string; token?: string };
        if (d.status === 'ok' && d.token) {
          clearInterval(timer);
          store.set('token', d.token);
          isNewLogin = true;
          $('login').classList.add('hidden');
          resolve(d.token);
        } else if (d.status === 'expired') await fresh();
      } catch { /* retry next tick */ }
    };
    const timer = setInterval(poll, 1500);
    // coming back from the Telegram app on mobile: check right away
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    fresh();
  });
}

/** name dialog: after the first login and whenever the player wants to rename */
function askName(current: string, first: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    if (document.pointerLockElement) document.exitPointerLock();
    const dlg = $('name-dialog'), input = $<HTMLInputElement>('name-input');
    $('name-title').textContent = first ? 'как тебя показывать?' : 'новое имя';
    $('name-cancel').classList.toggle('hidden', first);
    input.value = current;
    dlg.classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const done = (v: string | null) => {
      dlg.classList.add('hidden');
      $('name-save').onclick = null; input.onkeydown = null; $('name-cancel').onclick = null;
      resolve(v);
    };
    $('name-save').onclick = () => done(input.value.trim() || current);
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(input.value.trim() || current); if (e.key === 'Escape' && !first) done(null); };
    $('name-cancel').onclick = () => done(null);
  });
}

// ------------------------------------------------------------------ three setup
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 900);
camera.rotation.order = 'YXZ';
// the organism dreams the real sky over Minsk: moon night or dawn, synced by the clock for everyone
const sky = new Sky(scene);

// shared world state: doors (server) + wounds made with the pickaxe (server, heal after 15 min)
const doorOpen = new Map<string, boolean>(DOORS.map((d) => [d.id, true]));
const isDoorOpen = (id: string) => doorOpen.get(id) ?? true;
const broken = new Set<string>();
const ws: WorldState = { doorOpen: isDoorOpen, broken: (k) => broken.has(k) };

const world = buildWorld(scene, ws);
const cilia = buildCilia(scene, IS_TOUCH);
buildVoid(scene);
const paint = new PaintLayer(scene);
paint.isBroken = ws.broken;
const music = new Music();
const sfx = new Sfx();
// audio may only start from a user gesture
for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) addEventListener(ev, () => { if (me) sfx.unlock(); }, { passive: true });
new Visualizer(scene, (b) => music.spectrum(b), () => music.level);
// your own body: hidden from the first-person camera, shown only while a mirror renders its reflection
let selfAvatar: Avatar | null = null;
const mirrors = new Mirrors(scene, IS_TOUCH, (on) => { if (selfAvatar) selfAvatar.root.visible = on; });

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ state
const player = new Player(ws, Math.floor(Math.random() * 100));
let dead = false;
const avatars = new Map<string, Avatar>();
let me: PlayerInfo | null = null;
const panelCounts: Record<string, number> = {};
let net: Net | null = null;

// tools
const PALETTE = [0x1a1c2c, 0x5d275d, 0xb13e53, 0xef7d57, 0xffcd75, 0xa7f070, 0x38b764, 0x257179, 0x29366f, 0x3b5dc9, 0x41a6f6, 0x73eff7, 0xf4f4f4, 0x94b0c2, 0x566c86, 0xff77a8, 0xd64646];
// one brush to leave a mark, one pickaxe to wound the tissue (it heals in 15 minutes)
const TOOL_NAMES = ['кисть', 'кирка'];
const BRUSH = 0, PICK = 1;
let tool = Math.min(1, Number(store.get('tool') ?? 0));
let color = Number(store.get('color') ?? 0xff77a8);
let size = Number(store.get('size2') ?? 24);

// ------------------------------------------------------------------ input
const keys = new Set<string>();
const inp: InputState = { fwd: 0, right: 0, jump: false, crouch: false, sprint: false };
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
addEventListener('wheel', (e) => { if (locked) setSize(e.deltaY < 0 ? size * 1.15 + 1 : size / 1.15 - 1); }, { passive: true });

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  keys.add(e.code);
  // Ctrl is crouch: keep the browser from treating Ctrl+W/S/D as shortcuts while playing
  if (locked && (e.ctrlKey || e.metaKey) && e.code !== 'KeyR') e.preventDefault();
  if (e.code === 'Tab') { e.preventDefault(); if (locked) document.exitPointerLock(); }
  if (e.code === 'KeyE') toggleNearestDoor();
  if (e.code === 'KeyM') toggleMusic();
  if (e.code === 'KeyN') toggleSfx();
  if (e.code === 'KeyH') { if (locked) document.exitPointerLock(); }
  if (e.code === 'Digit1' || e.code === 'Digit2') setTool(Number(e.code.slice(5)) - 1);
  if (e.code === 'BracketRight') setSize(size + 2);
  if (e.code === 'BracketLeft') setSize(size - 2);
  if (e.code === 'KeyQ' || e.code === 'KeyR') {
    const i = PALETTE.indexOf(color);
    setColor(PALETTE[(i + (e.code === 'KeyR' ? 1 : -1) + PALETTE.length) % PALETTE.length]);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
// Ctrl+W closes the tab before JS can stop it: ask first while you are inside
addEventListener('beforeunload', (e) => { if (started && locked && !dead) { e.preventDefault(); e.returnValue = ''; } });
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
  const touchTool = (t: number) => {
    const on = !(touchDraw && tool === t);
    setTool(t);
    touchDraw = on;
    $('t-draw').classList.toggle('on', on && t === BRUSH);
    $('t-pick').classList.toggle('on', on && t === PICK);
    flushChunk(true);
  };
  hold('t-draw', (v) => { if (v) touchTool(BRUSH); });
  hold('t-pick', (v) => { if (v) touchTool(PICK); });
}

function readInput() {
  const k = (c: string) => keys.has(c);
  inp.fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  inp.right = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  inp.jump = k('Space') || touchJump;
  inp.crouch = k('ControlLeft') || k('ControlRight') || k('KeyC') || crouchToggle;
  inp.sprint = k('ShiftLeft') || k('ShiftRight');
  if (stick.id !== -1) { inp.fwd = -stick.y; inp.right = stick.x; inp.sprint = Math.hypot(stick.x, stick.y) > 0.97; }
  if (!locked && !IS_TOUCH) { inp.fwd = inp.right = 0; inp.jump = false; inp.sprint = false; }
}

// ------------------------------------------------------------------ toolbar UI
function toolIcon(t: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 11;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  const P = (a: number, b: number, w = 1, h = 1) => x.fillRect(a, b, w, h);
  if (t === 0) { P(7, 1, 3, 3); P(5, 3, 3, 3); P(3, 5, 3, 3); x.fillStyle = '#ff6fae'; P(1, 8, 2, 2); }
  if (t === 1) { x.fillStyle = '#e8dcc4'; P(2, 1, 7, 2); P(1, 2, 2, 2); P(8, 2, 2, 2); x.fillStyle = '#c9a27a'; P(5, 3, 1, 8); }
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
  tool = Math.max(0, Math.min(1, t)); store.set('tool', String(tool));
  document.querySelectorAll('.tool').forEach((el, i) => el.classList.toggle('on', i === tool));
  $('toolbar').classList.toggle('pick', tool === PICK);
  mining = null;
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
  size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(s))); store.set('size2', String(size));
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
    img.crossOrigin = 'anonymous';
    img.src = avatarUrl(info.photo, API);
    img.onerror = () => img.replaceWith(mushroomFace(info.uid));
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
    if (you) {
      const y = document.createElement('span'); y.className = 'you'; y.textContent = '(ты)'; row.appendChild(y);
      const b = document.createElement('button'); b.className = 'ren'; b.textContent = 'сменить имя'; b.onclick = () => renameFlow(); row.appendChild(b);
    }
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
function toggleSfx(force?: boolean) {
  const on = force ?? !sfx.enabled;
  sfx.setEnabled(on);
  store.set('sfx', on ? '1' : '0');
  $('btn-sfx').classList.toggle('on', on);
  $('btn-sfx').querySelector('span')!.textContent = on ? 'вкл' : 'выкл';
}
$('btn-sfx').onclick = () => toggleSfx();
toggleSfx(store.get('sfx') !== '0');
$('btn-help').onclick = () => { if (IS_TOUCH) alert('Левый круг — идти. Свайп справа — смотреть.\n✎ — режим рисования: води пальцем по стене.\n▲ прыжок · ▾ присесть · ⌂ дверь.\nРисовать можно. Стирать — нельзя.'); else $('pause').classList.remove('hidden'); };
$('logout').onclick = (e) => { e.stopPropagation(); store.del('token'); store.del('named'); location.reload(); };
$('rename').onclick = (e) => { e.stopPropagation(); renameFlow(); };
let pendingName: string | null = null;
let authFails = 0;
async function renameFlow() {
  if (!me) return;
  const n = await askName(me.name, false);
  if (n && n !== me.name) net?.send({ t: 'rename', name: n });
}

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
  if (v) v.target = open ? 1 : 0;
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
  const solid = raycastSolid(o.x, o.y, o.z, tmpDir.x, tmpDir.y, tmpDir.z, hit.t + 0.1, ws);
  if (solid < hit.t - 0.08) return null;
  if (solid > hit.t + 0.08) return null; // the tissue behind this spot is torn out
  if (insideMirror(hit.panel.id, hit.u, hit.v)) return null; // glass is not a canvas
  return hit;
}

function flushChunk(end = false) {
  if (!chunk) return;
  const c = chunk;
  if (c.cont && c.pts.length === 2) { chunk = null; return; }
  if (c.pts.length === 2) {
    // single dot
    paint.segment(c.panel, BRUSH, color, size, c.seed, 0, c.pts[0], c.pts[1], c.pts[0], c.pts[1]);
  }
  if (c.pts.length >= 2) {
    const d: StrokeData = [BRUSH, color, size, c.seed, c.pts];
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
  const active = (IS_TOUCH ? touchDraw : locked) && tool === BRUSH;
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
  if (dist >= minStep) {
    chunk.pts.push(u, v);
    chunk.lastAdd = now;
    const i = chunk.pts.length / 2 - 2;
    paint.segment(chunk.panel, BRUSH, color, size, chunk.seed, i, lu, lv, u, v);
  }
  if (chunk.pts.length >= MAX_STROKE_NUMS - 2 || (now - chunk.t0 > 120 && chunk.pts.length >= 4)) flushChunk(false);
}

// ------------------------------------------------------------------ pickaxe
// Hold to wound the tissue: wall segments (0.9 m) and floor plates. Takes `hardness` seconds,
// the server checks reach + speed, everyone sees the wound, the organism heals it in 15 minutes.
let mining: { key: string; t: number; need: number; L: number; x: number; z: number; s: number; lastHit: number } | null = null;
const hl = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1, 1.02), new THREE.MeshBasicMaterial({ color: 0xff6fae, wireframe: true, transparent: true, opacity: 0.7, depthTest: false, fog: false }));
hl.renderOrder = 11; hl.visible = false; scene.add(hl);

function blockBox(L: number, x: number, z: number, s: number) {
  const base = L * FLOOR_H;
  return s < 0 ? { y0: base - SLAB, y1: base } : { y0: base + s * SEG_H, y1: base + (s + 1) * SEG_H };
}
function updateMining(dt: number) {
  const active = (IS_TOUCH ? touchDraw : locked) && tool === PICK && !dead;
  const want = IS_TOUCH ? touchDraw && touchDrawPoint !== null : locked && mouseDown;
  let target: ReturnType<typeof raycastBlock> = null;
  if (active) {
    const sp = IS_TOUCH ? touchDrawPoint : null;
    if (sp) {
      raycaster.setFromCamera(new THREE.Vector2((sp.x / innerWidth) * 2 - 1, -(sp.y / innerHeight) * 2 + 1), camera);
      tmpDir.copy(raycaster.ray.direction);
    } else camera.getWorldDirection(tmpDir);
    const o = camera.position;
    target = raycastBlock(o.x, o.y, o.z, tmpDir.x, tmpDir.y, tmpDir.z, 5.5, ws);
  }
  if (target) {
    const b = blockBox(target.L, target.x, target.z, target.s);
    hl.visible = true;
    hl.position.set(target.x + 0.5, (b.y0 + b.y1) / 2, target.z + 0.5);
    hl.scale.set(1, (b.y1 - b.y0) + 0.02, 1);
  } else hl.visible = false;
  if (!want || !target) { mining = null; $('mine-bar').classList.add('hidden'); held.swing = 0; return; }
  if (!mining || mining.key !== target.key) mining = { key: target.key, t: 0, need: hardness(target.L, target.x, target.z, target.s), L: target.L, x: target.x, z: target.z, s: target.s, lastHit: 0 };
  mining.t += dt;
  held.swing += dt;
  const now = performance.now();
  if (now - mining.lastHit > 280) {
    mining.lastHit = now;
    sfx.pick(target.s < 0 ? floorSurface(target.L, target.x, target.z) : 'membrane');
  }
  $('mine-bar').classList.remove('hidden');
  ($('mine-bar').firstElementChild as HTMLElement).style.width = Math.min(100, (mining.t / mining.need) * 100) + '%';
  if (mining.t >= mining.need) {
    net?.send({ t: 'mine', k: mining.key });
    applyBroken(mining.key, true); // optimistic; the server confirms or heals it back
    sfx.tear();
    mining = null;
    $('mine-bar').classList.add('hidden');
  }
}
function floorSurface(L: number, x: number, z: number) {
  return surfaceAt(x + 0.5, L * FLOOR_H, z + 0.5);
}
function applyBroken(key: string, isBroken: boolean) {
  if (isBroken === broken.has(key)) return;
  if (isBroken) broken.add(key); else broken.delete(key);
  const { L, s } = parseKey(key);
  world.rebuildLevel(L);
  if (s < 0 && L > 0) world.rebuildLevel(L - 1);
  paint.refreshMasks(L);
}

// held item: a bone pickaxe or the brush, low in the right corner, swings while working
const held = { group: new THREE.Group(), pick: new THREE.Group(), brush: new THREE.Group(), swing: 0 };
{
  const bone = new THREE.MeshLambertMaterial({ color: 0xe8dcc4, emissive: 0x2a2018 });
  const sinew = new THREE.MeshLambertMaterial({ color: 0xa0405a, emissive: 0x30101a });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), sinew); handle.position.y = -0.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.07), bone); head.position.y = 0.14;
  const tip1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), bone); tip1.position.set(0.24, 0.11, 0);
  const tip2 = tip1.clone(); tip2.position.x = -0.24;
  held.pick.add(handle, head, tip1, tip2);
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), bone); stick.position.y = -0.05;
  const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.07), new THREE.MeshBasicMaterial({ color })); tuft.position.y = 0.2;
  tuft.name = 'tuft';
  held.brush.add(stick, tuft);
  held.group.add(held.pick, held.brush);
  held.group.position.set(0.3, -0.28, -0.6);
  held.group.rotation.set(0.2, -0.3, 0.25);
  held.group.scale.setScalar(0.55);
  held.group.traverse((o) => { o.renderOrder = 12; const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined; if (m) { m.depthTest = false; m.fog = false; } });
  camera.add(held.group);
  scene.add(camera);
}
function updateHeld(now: number) {
  held.group.visible = started && !dead && !(IS_TOUCH && !touchDraw);
  held.pick.visible = tool === PICK;
  held.brush.visible = tool === BRUSH;
  ((held.brush.getObjectByName('tuft') as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(color);
  const bob = player.moving && player.onGround ? Math.sin(now / (player.sprinting ? 70 : 110)) * 0.015 : 0;
  const sw = held.swing > 0 ? Math.sin(held.swing * 22) * 0.6 : (chunk ? Math.sin(now / 90) * 0.06 : 0);
  held.group.position.y = -0.28 + bob;
  held.group.rotation.x = 0.2 - Math.max(0, sw);
}

// ------------------------------------------------------------------ death
function die(fromServer: boolean) {
  if (dead) return;
  dead = true;
  player.dead = true;
  document.body.classList.add('dead');
  if (!fromServer) net?.send({ t: 'p', s: [player.x, player.y, player.z, player.yaw, player.pitch, 0] }); // the server sees you below the island
  setTimeout(() => net?.close(), 1500);
  if (document.pointerLockElement) document.exitPointerLock();
  $('pause').classList.add('hidden');
  $('death').classList.remove('hidden');
  sfx.fall();
  music.stop();
}

// ------------------------------------------------------------------ network
function onMsg(m: ServerMsg) {
  switch (m.t) {
    case 'welcome': {
      me = m.you;
      document.body.classList.add('authed');
      if (selfAvatar) { scene.remove(selfAvatar.root); selfAvatar.dispose(); }
      selfAvatar = new Avatar(me, API);
      selfAvatar.root.visible = false;
      scene.add(selfAvatar.root);
      if (pendingName && pendingName !== me.name) net?.send({ t: 'rename', name: pendingName });
      pendingName = null;
      for (const a of avatars.values()) { scene.remove(a.root); a.dispose(); }
      avatars.clear();
      for (const p of m.players) addAvatar(p);
      for (const s of m.states) avatars.get(s[0])?.push(s);
      for (const [id, open] of Object.entries(m.doors)) applyDoor(id, open);
      {
        const keys = new Set(m.broken.map(([k]) => k));
        const levels = new Set<number>();
        for (const k of [...broken, ...keys]) if (broken.has(k) !== keys.has(k)) { const { L, s } = parseKey(k); levels.add(L); if (s < 0 && L > 0) levels.add(L - 1); }
        broken.clear();
        for (const k of keys) broken.add(k);
        for (const L of levels) { world.rebuildLevel(L); paint.refreshMasks(L); }
      }
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
    case 'broken':
      applyBroken(m.k, true);
      if (m.by !== me?.id) {
        const { L, x, z, s } = parseKey(m.k);
        const d = Math.hypot(x + 0.5 - player.x, L * FLOOR_H + Math.max(0, s) * SEG_H - player.y, z + 0.5 - player.z);
        if (d < 18) sfx.tear(Math.pow(1 - d / 18, 2));
      }
      break;
    case 'heal': {
      let near = false;
      for (const k of m.k) {
        applyBroken(k, false);
        const { L, x, z } = parseKey(k);
        if (Math.hypot(x - player.x, L * FLOOR_H - player.y, z - player.z) < 14) near = true;
      }
      if (near) sfx.heal();
      break;
    }
    case 'dead':
      die(true);
      break;
    case 'died':
      if (m.id !== me?.id) feed(`☠ ${m.name} — бездна забрала навсегда`);
      break;
    case 'rename': {
      if (m.id === me?.id) { me.name = m.name; selfAvatar?.rename(m.name); }
      else avatars.get(m.id)?.rename(m.name);
      renderPlayers();
      break;
    }
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
  const flags = (player.crouching ? F_CROUCH : 0) | (player.moving ? F_MOVING : 0) | (chunk || mining ? F_DRAWING : 0);
  const s: [number, number, number, number, number, number] = [player.x, player.y, player.z, player.yaw, player.pitch, flags];
  const key = s.map((n) => n.toFixed(2)).join(',');
  if (key === lastSent && now - lastSend < 4000) return;
  lastSent = key; lastSend = now;
  net.send({ t: 'p', s });
}

// ------------------------------------------------------------------ music field
let lastField = 0;
let roomText = '';
function updateField(now: number) {
  if (now - lastField < 250) return;
  lastField = now;
  $('sky-label').textContent = sky.label();
  const myRoom = roomAt(player.x, player.y + 0.5, player.z);
  const roomLabel = myRoom < 0 ? (player.y > 1 ? 'снаружи · на теле' : 'поле ресничек') : ROOMS[myRoom].name;
  if (roomLabel !== roomText) { roomText = roomLabel; $('room-name').textContent = roomLabel; }
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

// ------------------------------------------------------------------ footsteps
let stepAcc = 0, airTime = 0;
const remoteSteps = new Map<string, { x: number; y: number; z: number; acc: number }>();
function footsteps(dt: number, px0: number, pz0: number, wasAir: boolean) {
  // own steps: every stride of ground travel; crouching is quieter and shorter-strided
  if (!player.onGround) { airTime += dt; stepAcc = 0.5; }
  else {
    if (wasAir && airTime > 0.25) sfx.step(surfaceAt(player.x, player.y, player.z), Math.min(1.2, 0.5 + airTime), 0, 1.8); // landing
    airTime = 0;
    stepAcc += Math.hypot(player.x - px0, player.z - pz0);
    const stride = player.crouching ? 0.55 : player.sprinting ? 1.35 : 0.75;
    if (stepAcc >= stride) { stepAcc -= stride; sfx.step(surfaceAt(player.x, player.y, player.z), player.crouching ? 0.4 : 0.85); }
  }
  // other players nearby: quiet, positioned
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const [id, a] of avatars) {
    if (!a.hasState) continue;
    let st = remoteSteps.get(id);
    if (!st) { st = { x: a.x, y: a.y, z: a.z, acc: 0 }; remoteSteps.set(id, st); }
    const moved = Math.hypot(a.x - st.x, a.z - st.z);
    const grounded = Math.abs(a.y - st.y) < 0.02;
    st.x = a.x; st.y = a.y; st.z = a.z;
    const dx = a.x - player.x, dz = a.z - player.z;
    const d = Math.hypot(dx, a.y - player.y, dz);
    if (d > 15 || !grounded || moved > 2) continue;
    st.acc += moved;
    if (st.acc >= 0.75) {
      st.acc -= 0.75;
      const pan = (dx * -fz + dz * fx) / (Math.hypot(dx, dz) || 1);
      sfx.step(surfaceAt(a.x, a.y, a.z), 0.55 * Math.pow(1 - d / 15, 2) * (a.flags & F_CROUCH ? 0.5 : 1), pan);
    }
  }
  for (const id of remoteSteps.keys()) if (!avatars.has(id)) remoteSteps.delete(id);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let bouncedSeen = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!me) return; // no world without a confirmed Telegram session
  const t = now / 1000;
  readInput();
  const px0 = player.x, pz0 = player.z, wasAir = !player.onGround;
  const climbed0 = player.climbMoved;
  player.update(dt, inp);
  if (player.dead && !dead) die(false);
  if (dead) { camera.position.y -= dt * 3; camera.rotation.x = Math.max(-1.5, camera.rotation.x - dt * 0.4); }
  footsteps(dt, px0, pz0, wasAir);
  if (Math.floor(player.climbMoved / 0.6) !== Math.floor(climbed0 / 0.6)) sfx.climb();
  if (player.bounced !== bouncedSeen) { bouncedSeen = player.bounced; music.event('bounce'); }
  if (!dead) {
    camera.position.set(player.x, player.eyeSmoothY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }
  // sprint widens the view a little
  const fov = player.sprinting && player.moving ? 86 : 75;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
  sky.update(camera.position, t);
  updateLife(t);
  cilia.uniforms.fogColor.value.copy(sky.fog.color);
  cilia.uniforms.fogNear.value = sky.fog.near;
  cilia.uniforms.fogFar.value = sky.fog.far;
  // the island edge: warn before the void
  const ex = player.x - CENTER, ez = player.z - CENTER;
  const edge = islandEdge(Math.atan2(ez, ex));
  $('edge-warn').classList.toggle('hidden', dead || !started || player.y > 2 || Math.hypot(ex, ez) < edge - 3.5);
  updateDoors(world.doors, dt);
  for (const a of avatars.values()) a.update(dt, camera.position);
  if (selfAvatar) {
    const flags = (player.crouching ? F_CROUCH : 0) | (player.moving ? F_MOVING : 0) | (chunk ? F_DRAWING : 0);
    selfAvatar.setDirect(player.x, player.y, player.z, player.yaw, player.pitch, flags);
    selfAvatar.update(dt, camera.position);
    selfAvatar.root.visible = false;
  }
  mirrors.update(camera.position);
  if (started && !dead) {
    updateDrawing();
    updateMining(dt);
    sendState(now);
    updateField(now);
  }
  updateHeld(now);
  paint.flush();
  renderer.render(scene, camera);
}

// every living surface knows where the nearest people are (and how lively they are)
let beatI = 0;
function updateLife(t: number) {
  const ppl: { x: number; y: number; z: number; w: number; d: number }[] = [];
  if (!dead) ppl.push({ x: player.x, y: player.y + 0.9, z: player.z, w: player.moving ? 1 : 0.6, d: 0 });
  for (const a of avatars.values()) {
    if (!a.hasState) continue;
    const d = Math.hypot(a.x - player.x, a.y - player.y, a.z - player.z);
    ppl.push({ x: a.x, y: a.y + 0.9, z: a.z, w: a.flags & (F_MOVING | F_DRAWING) ? 1 : 0.6, d });
  }
  ppl.sort((a, b) => a.d - b.d);
  const arr = LIFE.uPeople.value;
  for (let i = 0; i < MAX_PEOPLE; i++) {
    const p = ppl[i];
    if (p) arr[i].set(p.x, p.y, p.z, p.w); else arr[i].set(0, -999, 0, 0);
  }
  LIFE.uTime.value = t;
  // the heart beats faster the more alive the place is
  beatI += ((music.enabled ? music.level : 0) * 0.5 + Math.min(1, ppl.length / 6) * 0.5 - beatI) * 0.01;
  LIFE.uBeat.value = heartbeat(t, 48 + 30 * beatI);
}

// ------------------------------------------------------------------ boot
buildToolbar();
requestAnimationFrame(frame);
camera.position.set(20, 8, 44);

(async () => {
  const token = await getToken();
  const q = new URLSearchParams({ token });
  net = new Net(`${WS}/ws?${q}`);
  net.onMsg = onMsg;
  net.onStatus = (s) => {
    $('conn').classList.toggle('hidden', s === 'open');
    if (s === 'closed') $('conn').textContent = 'соединение потеряно… переподключаюсь';
    if (dead) { $('conn').classList.add('hidden'); return; }
    if (s === 'closed' && !me) {
      // session rejected by the server -> back to the Telegram login
      authFails++;
      if (authFails >= 2) { net?.close(); store.del('token'); location.reload(); }
    }
  };
  $('conn').classList.remove('hidden');
  net.connect();
  if (isNewLogin) {
    // first time: confirm or change the Telegram name before entering
    const tgName = await new Promise<string>((res) => { const t = setInterval(() => { if (me) { clearInterval(t); res(me.name); } }, 100); });
    const n = await askName(tgName, true);
    store.set('named', '1');
    if (n && n !== me!.name) net.send({ t: 'rename', name: n });
  }
  started = true;
  if (!IS_TOUCH && !dead) $('pause').classList.remove('hidden');
  // music: remembered choice, but browsers need a gesture to start audio
  if (store.get('music') === '1') {
    const kick = () => { toggleMusic(true); removeEventListener('pointerdown', kick); removeEventListener('keydown', kick); };
    addEventListener('pointerdown', kick);
    addEventListener('keydown', kick);
  }
})();

// debug / automated testing hook
(window as unknown as { __ez: unknown }).__ez = {
  player, camera, avatars, paint, music, doorOpen, sfx, broken, sky, world, ws,
  applyBroken, die: () => die(false),
  setTool: (t: number) => setTool(t),
  setLocked: (v: boolean) => setLocked(v),
  setMouse: (v: boolean) => { mouseDown = v; },
  toggleNearestDoor, setColor, setSize,
};
