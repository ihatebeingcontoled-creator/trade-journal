/* ──────────────────────────────────────────────────────────────────────────
   Capital Risked overrides  →  /api/overrides
   Save as:  functions/api/overrides.js   (no edits needed)

   Stores manual "Capital Risked" values in their own D1 table so they survive
   a Capital.com re-sync. Every handler is wrapped so it can never 500 silently:
   on any failure it returns the real error text in the body.
   ────────────────────────────────────────────────────────────────────────── */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* Find the D1 database among the bindings (any object exposing .prepare). */
function getDB(env) {
  for (const k in env) {
    let v;
    try { v = env[k]; } catch { continue; }
    if (v && typeof v === 'object' && typeof v.prepare === 'function') return v;
  }
  return null;
}

async function ensureTable(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS capital_overrides (date TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run();
}

/* Admin check with no config: match the password against any secret/env string,
   else fall back to the app's own /api/auth. */
async function isAdmin(env, request, pw) {
  if (!pw) return false;
  for (const k in env) {
    try { if (typeof env[k] === 'string' && env[k] === pw) return true; } catch {}
  }
  try {
    const a = await fetch(new URL('/api/auth', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (a.ok) return true;
  } catch {}
  return false;
}

export async function onRequestGet({ env }) {
  try {
    const db = getDB(env);
    if (!db) return json({ error: 'No D1 database binding found on this project' }, 500);
    await ensureTable(db);
    const { results } = await db.prepare('SELECT date, value FROM capital_overrides').all();
    const map = {};
    for (const row of results || []) map[row.date] = row.value;
    return json(map, 200);
  } catch (e) {
    return json({ error: 'GET failed: ' + (e && e.message ? e.message : String(e)) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const pw = request.headers.get('X-Admin-Password') || '';
    if (!(await isAdmin(env, request, pw))) return json({ error: 'unauthorized' }, 401);

    const db = getDB(env);
    if (!db) return json({ error: 'No D1 database binding found on this project' }, 500);
    await ensureTable(db);

    let body;
    try { body = await request.json(); } catch { body = {}; }
    const date = body.date;
    const value = body.value;
    if (!date) return json({ error: 'missing date' }, 400);

    if (value === '' || value === null || value === undefined) {
      await db.prepare('DELETE FROM capital_overrides WHERE date = ?').bind(date).run();
    } else {
      await db.prepare(
        'INSERT INTO capital_overrides (date, value) VALUES (?, ?) ' +
        'ON CONFLICT(date) DO UPDATE SET value = excluded.value'
      ).bind(date, String(value)).run();
    }
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: 'POST failed: ' + (e && e.message ? e.message : String(e)) }, 500);
  }
}
