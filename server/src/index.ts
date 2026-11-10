import { DurableObject } from 'cloudflare:workers';
import { DEATH_Y, REBIRTH_MS, DOOR_BY_ID, PANEL_BY_ID, REGROW_MS, distToBox, keyBox, keyHardness } from '../../shared/world';
import { MAX_SIZE, MAX_STROKE_NUMS, MIN_SIZE, type ClientMsg, type PlayerInfo, type PState, type ServerMsg, type StrokeData } from '../../shared/protocol';

export interface Env {
  WORLD: DurableObjectNamespace<World>;
  BOT_TOKEN?: string;
  BOT_USERNAME?: string;
  SESSION_SECRET?: string;
  ADMIN_KEY?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });

// ---------------- crypto helpers ----------------
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

function secretOf(env: Env) {
  return env.SESSION_SECRET || 'dev-secret-change-me';
}
async function signSession(env: Env, user: { uid: string; name: string; photo: string | null }) {
  const body = b64u(JSON.stringify({ ...user, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  const sig = hex(await hmac(enc.encode(secretOf(env)), body));
  return body + '.' + sig;
}
async function verifySession(env: Env, token: string) {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = hex(await hmac(enc.encode(secretOf(env)), body));
  if (want !== sig) return null;
  const data = JSON.parse(unb64u(body));
  if (data.exp < Date.now()) return null;
  if (typeof data.uid !== 'string' || !/^tg:\d+$/.test(data.uid)) return null; // Telegram accounts only
  return data as { uid: string; name: string; photo: string | null };
}

function cleanName(s: string) {
  return (s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'спора';
}

async function verifyWidget(env: Env, data: Record<string, string>) {
  if (!env.BOT_TOKEN) return null;
  const { hash, ...rest } = data;
  const check = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', enc.encode(env.BOT_TOKEN));
  if (hex(await hmac(secret, check)) !== hash) return null;
  if (Date.now() / 1000 - Number(rest.auth_date) > 86400 * 2) return null;
  const name = [rest.first_name, rest.last_name].filter(Boolean).join(' ') || rest.username;
  return { uid: 'tg:' + rest.id, name: cleanName(name), photo: rest.photo_url || null };
}

async function verifyWebApp(env: Env, initData: string) {
  if (!env.BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(enc.encode('WebAppData'), env.BOT_TOKEN);
  if (hex(await hmac(secret, check)) !== hash) return null;
  const u = JSON.parse(params.get('user') || '{}');
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;
  return { uid: 'tg:' + u.id, name: cleanName(name), photo: u.photo_url || null };
}

const GAME_URL = 'https://yuriryzhenkov.github.io/existenzzz/';
async function webhookSecret(env: Env) {
  return hex(await hmac(enc.encode(secretOf(env)), 'tg-webhook')).slice(0, 40);
}
async function tg(env: Env, method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json() as Promise<{ ok: boolean; result?: any; description?: string }>;
}

// ---------------- Worker entry ----------------
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const world = () => env.WORLD.get(env.WORLD.idFromName('world-main'));

    switch (url.pathname) {
      case '/':
        return new Response('existenzzz server: alive', { headers: CORS });
      case '/api/config':
        return json({ bot: env.BOT_USERNAME || null });
      case '/api/auth/telegram': {
        const data = (await req.json()) as Record<string, string>;
        const user = await verifyWidget(env, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])));
        if (!user) return json({ error: 'bad telegram auth' }, 401);
        return json({ token: await signSession(env, user), user });
      }
      case '/api/auth/webapp': {
        const { initData } = (await req.json()) as { initData: string };
        const user = await verifyWebApp(env, initData);
        if (!user) return json({ error: 'bad webapp auth' }, 401);
        return json({ token: await signSession(env, user), user });
      }
      case '/api/me': {
        const user = await verifySession(env, url.searchParams.get('token') || '');
        if (!user) return json({ error: 'telegram login required' }, 401);
        return json({ user });
      }
      case '/api/login/start': {
        const r = await world().fetch(new Request('https://world/login/start', { method: 'POST' }));
        const { code } = (await r.json()) as { code: string };
        const bot = env.BOT_USERNAME;
        return json({ code, url: `https://t.me/${bot}?start=login_${code}`, tg: `tg://resolve?domain=${bot}&start=login_${code}` });
      }
      case '/api/login/poll': {
        const code = (url.searchParams.get('code') || '').replace(/[^a-z0-9]/gi, '');
        const r = await world().fetch(new Request('https://world/login/poll?code=' + code));
        const data = (await r.json()) as { status: string; user?: { uid: string; name: string; photo: string | null } };
        if (data.status === 'ok' && data.user) return json({ status: 'ok', token: await signSession(env, data.user), user: data.user });
        return json({ status: data.status });
      }
      case '/api/tg/setup': {
        if (!env.BOT_TOKEN) return json({ error: 'no bot' }, 400);
        const res = await tg(env, 'setWebhook', { url: url.origin + '/api/tg/webhook', secret_token: await webhookSecret(env), allowed_updates: ['message'], drop_pending_updates: true });
        return json(res);
      }
      case '/api/tg/webhook': {
        if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await webhookSecret(env))) return new Response('forbidden', { status: 403 });
        const upd = (await req.json()) as { message?: { text?: string; chat: { id: number }; from?: { id: number; first_name?: string; last_name?: string; username?: string } } };
        const m = upd.message;
        if (!m?.from || !m.text) return new Response('ok');
        const payload = m.text.startsWith('/start') ? m.text.split(' ')[1] || '' : '';
        const playButtons = { inline_keyboard: [[{ text: '🍄 Играть в Telegram', web_app: { url: GAME_URL } }], [{ text: 'Открыть в браузере', url: GAME_URL }]] };
        if (payload.startsWith('login_')) {
          const f = m.from;
          const name = cleanName([f.first_name, f.last_name].filter(Boolean).join(' ') || f.username || '');
          const user = { uid: 'tg:' + f.id, name, photo: '/api/avatar?tg=' + f.id };
          const r = await world().fetch(new Request('https://world/login/confirm', { method: 'POST', body: JSON.stringify({ code: payload.slice(6), user }) }));
          const ok = r.ok;
          ctx.waitUntil(tg(env, 'sendMessage', {
            chat_id: m.chat.id,
            text: ok ? `Готово, ${name} ✨\nВозвращайся в игру — ты уже внутри.` : 'Эта ссылка для входа устарела. Обнови страницу игры и попробуй ещё раз.',
            reply_markup: ok ? undefined : playButtons,
          }));
        } else {
          ctx.waitUntil(tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'EXISTENZZZ — общее грибное пространство. Ходи, рисуй на стенах, слушай музыку, которая слышит людей рядом.', reply_markup: playButtons }));
        }
        return new Response('ok');
      }
      case '/api/avatar': {
        const tgId = (url.searchParams.get('tg') || '').replace(/[^0-9]/g, '');
        if (tgId) {
          const cache = caches.default;
          const key = new Request(url.toString());
          const hit = await cache.match(key);
          if (hit) return hit;
          if (!env.BOT_TOKEN) return json({ error: 'no bot' }, 404);
          const photos = await tg(env, 'getUserProfilePhotos', { user_id: Number(tgId), limit: 1 });
          const sizes = photos.result?.photos?.[0] as { file_id: string; width: number }[] | undefined;
          if (!sizes?.length) return json({ error: 'no photo' }, 404, { 'cache-control': 'public, max-age=3600' });
          const file = await tg(env, 'getFile', { file_id: sizes[0].file_id });
          if (!file.result?.file_path) return json({ error: 'no file' }, 404);
          const img = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.result.file_path}`);
          const res = new Response(img.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400', ...CORS } });
          ctx.waitUntil(cache.put(key, res.clone()));
          return res;
        }
        const u = url.searchParams.get('u') || '';
        let target: URL;
        try { target = new URL(u); } catch { return json({ error: 'bad url' }, 400); }
        if (target.protocol !== 'https:' || !/(^|\.)(t\.me|telegram\.org|telegram-cdn\.org|telesco\.pe)$/.test(target.hostname)) return json({ error: 'host not allowed' }, 400);
        const cache = caches.default;
        const key = new Request(url.toString());
        const hit = await cache.match(key);
        if (hit) return hit;
        const r = await fetch(target.toString(), { redirect: 'follow' });
        if (!r.ok) return json({ error: 'upstream' }, 502);
        const res = new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=86400', ...CORS } });
        ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }
      case '/ws': {
        if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
        const token = url.searchParams.get('token');
        let user: { uid: string; name: string; photo: string | null } | null = null;
        if (token) user = await verifySession(env, token);
        if (!user) return new Response('login required', { status: 401 });
        const fwd = new URL('https://world/ws');
        fwd.searchParams.set('u', JSON.stringify(user));
        return world().fetch(new Request(fwd, req));
      }
      case '/api/admin/revive': {
        if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
        return world().fetch(new Request('https://world/admin/revive?uid=' + encodeURIComponent(url.searchParams.get('uid') || '')));
      }
      case '/api/panels':
      case '/api/stats':
        return world().fetch(new Request('https://world' + url.pathname + url.search));
    }
    return json({ error: 'not found' }, 404);
  },
};

// ---------------- World Durable Object ----------------
interface Attach {
  info: PlayerInfo;
  s: [number, number, number, number, number, number] | null;
}

interface Conn {
  ws: WebSocket;
  info: PlayerInfo;
  s: [number, number, number, number, number, number] | null;
  lastPersist: number;
  bucket: number; // stroke rate limit tokens
  bucketT: number;
  doorT: number;
  mineT: number;
}

export class World extends DurableObject<Env> {
  sql: SqlStorage;
  conns = new Map<WebSocket, Conn>();
  dirty = new Set<Conn>();
  flushTimer: ReturnType<typeof setTimeout> | null = null;
  panelCounts: Map<string, number> | null = null;
  doors: Map<string, boolean> | null = null;
  totalStrokes = 0;
  brokenMap: Map<string, number> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS strokes (id INTEGER PRIMARY KEY AUTOINCREMENT, panel TEXT NOT NULL, uid TEXT NOT NULL, d TEXT NOT NULL, t INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS strokes_panel ON strokes(panel, id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS doors (id TEXT PRIMARY KEY, open INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS logins (code TEXT PRIMARY KEY, created INTEGER NOT NULL, user TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, name TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS dead (uid TEXT PRIMARY KEY, name TEXT, t INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS broken (k TEXT PRIMARY KEY, until INTEGER NOT NULL, uid TEXT)`);
    // restore connections after hibernation
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attach | null;
      if (a) this.conns.set(ws, { ws, info: a.info, s: a.s, lastPersist: 0, bucket: 40, bucketT: Date.now(), doorT: 0, mineT: 0 });
    }
  }

  getPanelCounts() {
    if (!this.panelCounts) {
      this.panelCounts = new Map();
      this.totalStrokes = 0;
      for (const r of this.sql.exec<{ panel: string; n: number }>(`SELECT panel, COUNT(*) AS n FROM strokes GROUP BY panel`)) {
        this.panelCounts.set(r.panel, r.n);
        this.totalStrokes += r.n;
      }
    }
    return this.panelCounts;
  }
  getDoors() {
    if (!this.doors) {
      this.doors = new Map();
      for (const d of DOOR_BY_ID.keys()) this.doors.set(d, true);
      for (const r of this.sql.exec<{ id: string; open: number }>(`SELECT id, open FROM doors`)) this.doors.set(r.id, !!r.open);
    }
    return this.doors;
  }

  getBroken() {
    if (!this.brokenMap) {
      this.brokenMap = new Map();
      for (const r of this.sql.exec<{ k: string; until: number }>(`SELECT k, until FROM broken`)) this.brokenMap.set(r.k, r.until);
    }
    return this.brokenMap;
  }

  /** living tissue heals: wounded blocks regrow after REGROW_MS */
  async alarm() {
    const now = Date.now();
    const b = this.getBroken();
    const healed: string[] = [];
    for (const [k, until] of b) if (until <= now) { healed.push(k); b.delete(k); }
    if (healed.length) {
      this.sql.exec(`DELETE FROM broken WHERE until <= ?`, now);
      this.broadcast({ t: 'heal', k: healed });
    }
    this.scheduleHeal();
  }
  scheduleHeal() {
    let next = Infinity;
    for (const until of this.getBroken().values()) next = Math.min(next, until);
    if (next < Infinity) this.ctx.storage.setAlarm(Math.max(Date.now() + 500, next));
  }

  /** 0 if alive, else the time the new body will be ready */
  deadUntil(uid: string) {
    const r = [...this.sql.exec(`SELECT t FROM dead WHERE uid = ?`, uid)][0] as { t: number } | undefined;
    if (!r) return 0;
    const until = r.t + REBIRTH_MS;
    return until > Date.now() ? until : 0;
  }
  kill(conn: Conn) {
    this.sql.exec(`INSERT OR REPLACE INTO dead (uid, name, t) VALUES (?, ?, ?)`, conn.info.uid, conn.info.name, Date.now());
    for (const c of [...this.conns.values()]) if (c.info.uid === conn.info.uid) {
      try { c.ws.send(JSON.stringify({ t: 'dead', until: Date.now() + REBIRTH_MS } satisfies ServerMsg)); } catch { /* */ }
      this.broadcast({ t: 'died', id: c.info.id, name: c.info.name }, c.ws);
      this.conns.delete(c.ws);
      this.dirty.delete(c);
      try { c.ws.close(4001, 'dead'); } catch { /* */ }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') return this.accept(JSON.parse(url.searchParams.get('u')!));
    if (url.pathname === '/admin/revive') {
      const uid = url.searchParams.get('uid') || '';
      this.sql.exec(`DELETE FROM dead WHERE uid = ?`, uid);
      return json({ ok: true, uid });
    }
    if (url.pathname === '/login/start') {
      const now = Date.now();
      this.sql.exec(`DELETE FROM logins WHERE created < ?`, now - 15 * 60 * 1000);
      const code = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      this.sql.exec(`INSERT INTO logins (code, created, user) VALUES (?, ?, NULL)`, code, now);
      return json({ code });
    }
    if (url.pathname === '/login/confirm') {
      const { code, user } = (await req.json()) as { code: string; user: unknown };
      const row = [...this.sql.exec<{ created: number }>(`SELECT created FROM logins WHERE code = ?`, code)][0];
      if (!row || Date.now() - row.created > 10 * 60 * 1000) return json({ error: 'expired' }, 410);
      this.sql.exec(`UPDATE logins SET user = ? WHERE code = ?`, JSON.stringify(user), code);
      return json({ ok: true });
    }
    if (url.pathname === '/login/poll') {
      const code = url.searchParams.get('code') || '';
      const row = [...this.sql.exec<{ created: number; user: string | null }>(`SELECT created, user FROM logins WHERE code = ?`, code)][0];
      if (!row || Date.now() - row.created > 10 * 60 * 1000) return json({ status: 'expired' });
      if (!row.user) return json({ status: 'pending' });
      this.sql.exec(`DELETE FROM logins WHERE code = ?`, code);
      return json({ status: 'ok', user: JSON.parse(row.user) });
    }
    if (url.pathname === '/api/stats') {
      this.getPanelCounts();
      return json({ online: this.conns.size, strokes: this.totalStrokes, players: [...this.conns.values()].map((c) => c.info.name) });
    }
    if (url.pathname === '/api/panels') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter((id) => PANEL_BY_ID.has(id)).slice(0, 40);
      const out: Record<string, StrokeData[]> = {};
      for (const id of ids) {
        out[id] = [];
        for (const r of this.sql.exec<{ d: string }>(`SELECT d FROM strokes WHERE panel = ? ORDER BY id`, id)) out[id].push(JSON.parse(r.d));
      }
      return json(out, 200, { 'cache-control': 'no-store' });
    }
    return json({ error: 'not found' }, 404);
  }

  accept(user: { uid: string; name: string; photo: string | null }) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const until = this.deadUntil(user.uid);
    if (until) {
      server.send(JSON.stringify({ t: 'dead', until } satisfies ServerMsg));
      server.close(4001, 'dead');
      return new Response(null, { status: 101, webSocket: client });
    }
    const custom = [...this.sql.exec<{ name: string }>(`SELECT name FROM users WHERE uid = ?`, user.uid)][0];
    const info: PlayerInfo = { id: crypto.randomUUID().slice(0, 8), uid: user.uid, name: custom?.name || user.name, photo: user.photo };
    const conn: Conn = { ws: server, info, s: null, lastPersist: 0, bucket: 40, bucketT: Date.now(), doorT: 0, mineT: 0 };
    server.serializeAttachment({ info, s: null } satisfies Attach);
    const others = [...this.conns.values()];
    this.conns.set(server, conn);
    const counts = this.getPanelCounts();
    const welcome: ServerMsg = {
      t: 'welcome',
      you: info,
      players: others.map((c) => c.info),
      states: others.filter((c) => c.s).map((c) => [c.info.id, ...c.s!] as PState),
      doors: Object.fromEntries(this.getDoors()),
      panels: Object.fromEntries(counts),
      strokes: this.totalStrokes,
      broken: [...this.getBroken()],
    };
    server.send(JSON.stringify(welcome));
    this.broadcast({ t: 'join', p: info }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg: ServerMsg, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.conns.keys()) {
      if (ws === except) continue;
      try { ws.send(s); } catch { /* closed */ }
    }
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.dirty.size) return;
      const d: PState[] = [];
      for (const c of this.dirty) if (c.s) d.push([c.info.id, ...c.s]);
      this.dirty.clear();
      this.broadcast({ t: 'ps', d });
    }, 1000 / 10);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const conn = this.conns.get(ws);
    if (!conn || typeof raw !== 'string' || raw.length > 16000) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(raw); } catch { return; }
    const now = Date.now();
    switch (msg.t) {
      case 'p': {
        const s = msg.s;
        if (!Array.isArray(s) || s.length !== 6 || !s.every((n) => typeof n === 'number' && isFinite(n))) return;
        const r = (n: number, k = 100) => Math.round(n * k) / k;
        conn.s = [r(s[0]), r(s[1]), r(s[2]), r(s[3]), r(s[4]), s[5] & 7];
        if (s[1] < DEATH_Y) { this.kill(conn); return; } // fell off the island: forever
        this.dirty.add(conn);
        this.scheduleFlush();
        if (now - conn.lastPersist > 3000) {
          conn.lastPersist = now;
          ws.serializeAttachment({ info: conn.info, s: conn.s } satisfies Attach);
        }
        break;
      }
      case 's': {
        // token bucket: 25 strokes/s, burst 50
        conn.bucket = Math.min(50, conn.bucket + ((now - conn.bucketT) / 1000) * 25);
        conn.bucketT = now;
        if (conn.bucket < 1) return;
        conn.bucket -= 1;
        const panel = PANEL_BY_ID.get(msg.p);
        const d = msg.d;
        if (!panel || !Array.isArray(d) || d.length !== 5) return;
        const [tool, color, size, seed, pts] = d;
        if (![0, 1, 2, 3, 4].includes(tool)) return;
        if (!Number.isInteger(color) || color < 0 || color > 0xffffff) return;
        if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) return;
        if (!Number.isInteger(seed)) return;
        if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_STROKE_NUMS || pts.length % 2) return;
        const W = Math.ceil(panel.w * 100), H = Math.ceil(panel.h * 100);
        for (let i = 0; i < pts.length; i += 2) {
          if (!Number.isInteger(pts[i]) || !Number.isInteger(pts[i + 1])) return;
          if (pts[i] < -50 || pts[i] > W + 50 || pts[i + 1] < -50 || pts[i + 1] > H + 50) return;
        }
        const data: StrokeData = [tool, color, size, seed | 0, pts];
        this.sql.exec(`INSERT INTO strokes (panel, uid, d, t) VALUES (?, ?, ?, ?)`, panel.id, conn.info.uid, JSON.stringify(data), now);
        const counts = this.getPanelCounts();
        counts.set(panel.id, (counts.get(panel.id) || 0) + 1);
        this.totalStrokes++;
        this.broadcast({ t: 's', p: panel.id, d: data, by: conn.info.id }, ws);
        break;
      }
      case 'door': {
        if (!DOOR_BY_ID.has(msg.id) || now - conn.doorT < 300) return;
        conn.doorT = now;
        const doors = this.getDoors();
        const open = !doors.get(msg.id);
        doors.set(msg.id, open);
        this.sql.exec(`INSERT OR REPLACE INTO doors (id, open) VALUES (?, ?)`, msg.id, open ? 1 : 0);
        this.broadcast({ t: 'door', id: msg.id, open });
        break;
      }
      case 'mine': {
        if (typeof msg.k !== 'string' || msg.k.length > 40 || !conn.s) return;
        const hard = keyHardness(msg.k);
        if (!hard || now - conn.mineT < hard * 700) return;
        const b = this.getBroken();
        if (b.has(msg.k)) return;
        const box = keyBox(msg.k);
        if (!box || distToBox(box, conn.s[0], conn.s[1] + 1.5, conn.s[2]) > 6.5) return;
        conn.mineT = now;
        const until = now + REGROW_MS;
        b.set(msg.k, until);
        this.sql.exec(`INSERT OR REPLACE INTO broken (k, until, uid) VALUES (?, ?, ?)`, msg.k, until, conn.info.uid);
        this.broadcast({ t: 'broken', k: msg.k, by: conn.info.id, until });
        this.scheduleHeal();
        break;
      }
      case 'rename': {
        const name = cleanName(typeof msg.name === 'string' ? msg.name : '');
        if (now - conn.doorT < 1000 || name === conn.info.name) return;
        conn.doorT = now;
        this.sql.exec(`INSERT OR REPLACE INTO users (uid, name) VALUES (?, ?)`, conn.info.uid, name);
        // update every connection of this user (several tabs)
        for (const c of this.conns.values()) if (c.info.uid === conn.info.uid) {
          c.info.name = name;
          c.ws.serializeAttachment({ info: c.info, s: c.s } satisfies Attach);
          this.broadcast({ t: 'rename', id: c.info.id, name });
        }
        break;
      }
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong' } satisfies ServerMsg));
        break;
    }
  }

  drop(ws: WebSocket) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    this.dirty.delete(conn);
    this.broadcast({ t: 'leave', id: conn.info.id });
  }
  async webSocketClose(ws: WebSocket, code: number) {
    this.drop(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }
  async webSocketError(ws: WebSocket) {
    this.drop(ws);
  }
}
