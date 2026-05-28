/**
 * GET  /api/rules  → returns [{id, text}, ...] ordered by id (1..10). Public.
 * POST /api/rules  → upserts all rules. Admin only (X-Admin-Password header).
 *
 * D1 binding: DB
 * Env var:    ADMIN_PASSWORD
 *
 * Rules table (created by rules-schema.sql):
 *   CREATE TABLE IF NOT EXISTS rules (
 *     id          INTEGER PRIMARY KEY,
 *     text        TEXT DEFAULT '',
 *     updated_at  INTEGER DEFAULT 0
 *   );
 */
 
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
};
 
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
 
function isAuthed(request, env) {
  return request.headers.get('X-Admin-Password') === env.ADMIN_PASSWORD;
}
 
/* ── GET: public list of rules ─────────────────────────────── */
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB
      .prepare('SELECT id, text FROM rules ORDER BY id')
      .all();
    return json(results || []);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
 
/* ── POST: admin upsert of all 10 rules ────────────────────── */
export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const body  = await request.json();
    const rules = Array.isArray(body) ? body : body.rules;
    if (!Array.isArray(rules)) {
      return json({ error: 'Expected { rules: [...] }' }, 400);
    }
 
    const now  = Date.now();
    const stmt = env.DB.prepare(
      'INSERT INTO rules (id, text, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at'
    );
 
    const batch = rules
      .filter((r) => r && Number.isInteger(r.id) && r.id >= 1 && r.id <= 10)
      .map((r) => stmt.bind(r.id, String(r.text ?? ''), now));
 
    if (batch.length) await env.DB.batch(batch);
 
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
 
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
 
