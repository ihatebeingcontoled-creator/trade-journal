/**
 * GET  /api/rules → returns [{id, text}, ...] for id 1..10. Public.
 * POST /api/rules → upserts all rules. Admin only.
 * Body: { rules: [{ id: 1, text: '...' }, ...] }
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
 
export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const body  = await request.json();
    const rules = Array.isArray(body) ? body : (body && body.rules);
    if (!Array.isArray(rules)) {
      return json({ error: 'Expected { rules: [...] }' }, 400);
    }
 
    for (const r of rules) {
      const id = parseInt(r && r.id);
      if (!Number.isInteger(id) || id < 1 || id > 10) continue;
      await env.DB.prepare(`
        INSERT INTO rules (id, text, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          text       = excluded.text,
          updated_at = excluded.updated_at
      `).bind(id, String((r && r.text) ?? ''), Date.now()).run();
    }
 
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
 
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
