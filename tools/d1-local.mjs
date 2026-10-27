// A tiny stand-in for Cloudflare D1 on top of Node's built-in SQLite, so the
// dev server and the tests run the real API Worker locally.
import { DatabaseSync } from 'node:sqlite';

export function localD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql) };
}
