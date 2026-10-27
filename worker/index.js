// The game is static files; this Worker adds two small APIs on /api/*:
//   cloud saves  — a save slot per random code (the code is the key; no accounts)
//   daily scores — the Endless Siege daily challenge leaderboard
// Everything else falls through to the static assets.
// Storage: one D1 database bound as DB (tables are created on first use).

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS saves (code TEXT PRIMARY KEY, data TEXT NOT NULL, saved_at INTEGER NOT NULL, updated INTEGER NOT NULL, device TEXT, version TEXT)',
  'CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, name TEXT NOT NULL, waves INTEGER NOT NULL, kills INTEGER NOT NULL, platform TEXT, player TEXT, created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS scores_day ON scores (day, waves DESC, kills DESC)',
  'CREATE UNIQUE INDEX IF NOT EXISTS scores_player_day ON scores (day, player)',
];
const MAX_SAVE = 900_000; // bytes of JSON
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  for (const s of SCHEMA) await db.prepare(s).run();
  schemaReady = true;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

function newCode() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  const s = [...b].map((x) => CODE_CHARS[x % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

async function body(req) {
  const text = await req.text();
  if (text.length > MAX_SAVE + 2000) throw Object.assign(new Error('too big'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

const utcDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, n);

async function api(req, env, url) {
  const db = env.DB;
  if (!db) return json({ error: 'Cloud features are not set up on this server.' }, 503);
  await ensureSchema(db);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // ---- cloud saves ----
  if (parts[1] === 'cloud') {
    if (parts.length === 2 && req.method === 'POST') {
      const b = await body(req);
      const data = JSON.stringify(b.data || null);
      if (data.length > MAX_SAVE) return json({ error: 'Save is too large.' }, 413);
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = await db.prepare('INSERT OR IGNORE INTO saves (code, data, saved_at, updated, device, version) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(code, data, Number(b.savedAt) || 0, Date.now(), clean(b.device, 24), clean(b.version, 12)).run();
        if (r.meta.changes) return json({ code, updated: Date.now() }, 201);
      }
      return json({ error: 'Try again.' }, 500);
    }
    const code = (parts[2] || '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'That code doesn\'t look right.' }, 400);
    if (req.method === 'GET') {
      const row = await db.prepare('SELECT data, saved_at, updated, device, version FROM saves WHERE code = ?').bind(code).first();
      if (!row) return json({ error: 'No cloud save with that code.' }, 404);
      return json({ data: JSON.parse(row.data), savedAt: row.saved_at, updated: row.updated, device: row.device, version: row.version });
    }
    if (req.method === 'PUT') {
      const b = await body(req);
      const data = JSON.stringify(b.data || null);
      if (data.length > MAX_SAVE) return json({ error: 'Save is too large.' }, 413);
      const row = await db.prepare('SELECT saved_at, device FROM saves WHERE code = ?').bind(code).first();
      if (!row) return json({ error: 'No cloud save with that code.' }, 404);
      const savedAt = Number(b.savedAt) || 0;
      // Never overwrite progress made on another device unless asked to.
      if (!b.force && row.saved_at > savedAt) return json({ conflict: true, savedAt: row.saved_at, device: row.device });
      await db.prepare('UPDATE saves SET data = ?, saved_at = ?, updated = ?, device = ?, version = ? WHERE code = ?')
        .bind(data, savedAt, Date.now(), clean(b.device, 24), clean(b.version, 12), code).run();
      return json({ ok: true, updated: Date.now() });
    }
  }

  // ---- daily challenge leaderboard ----
  if (parts[1] === 'scores') {
    if (req.method === 'GET') {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : utcDay();
      const { results } = await db.prepare('SELECT name, waves, kills, platform FROM scores WHERE day = ? ORDER BY waves DESC, kills DESC, created ASC LIMIT 20').bind(day).all();
      const total = await db.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ?').bind(day).first();
      return json({ day, top: results, players: total ? total.n : 0 });
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const day = String(b.day || '');
      if (day !== utcDay() && day !== utcDay(-1)) return json({ error: 'That challenge has closed.' }, 400);
      const name = clean(b.name, 16) || 'Anonymous';
      const player = clean(b.player, 40);
      const waves = Math.max(0, Math.min(200, Math.floor(Number(b.waves) || 0)));
      const kills = Math.max(0, Math.min(waves * 40 + 40, Math.floor(Number(b.kills) || 0)));
      if (!player) return json({ error: 'Missing player id.' }, 400);
      await db.prepare(`INSERT INTO scores (day, name, waves, kills, platform, player, created) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, player) DO UPDATE SET name = excluded.name, waves = excluded.waves, kills = excluded.kills, platform = excluded.platform, created = excluded.created
        WHERE excluded.waves > scores.waves OR (excluded.waves = scores.waves AND excluded.kills > scores.kills)`)
        .bind(day, name, waves, kills, clean(b.platform, 12), player, Date.now()).run();
      const best = await db.prepare('SELECT waves, kills FROM scores WHERE day = ? AND player = ?').bind(day, player).first();
      const rank = await db.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND (waves > ? OR (waves = ? AND kills > ?))').bind(day, best.waves, best.waves, best.kills).first();
      return json({ ok: true, rank: (rank ? rank.n : 0) + 1, best });
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      return await api(req, env, url);
    } catch (e) {
      return json({ error: e.status ? e.message : 'Server error' }, e.status || 500);
    }
  },
};
