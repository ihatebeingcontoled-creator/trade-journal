/* ──────────────────────────────────────────────────────────────────────────
   Capital Risked overrides  →  /api/overrides
   Save this as:  functions/api/overrides.js   (no edits needed)

   Stores your manual "Capital Risked" values in their own D1 table that your
   /api/sync never touches — so a Capital.com sync can't wipe them, and they
   follow you across every device.

   • Finds your D1 database automatically (no binding name to set).
   • Reuses your existing /api/auth password (nothing to configure).
   • Creates its table automatically on first use (no migration to run).
   ────────────────────────────────────────────────────────────────────────── */

function getDB(env) {
  for (const k in env) {
    const v = env[k];
    if (v && typeof v.prepare === 'function') return v;   // that's the D1 database
  }
  return null;
}

async function ensureTable(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS capital_overrides (date TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run();
}

/* GET -> { "YYYY-MM-DD": "1000", ... } */
export async function onRequestGet({ env }) {
  const db = getDB(env);
  if (!db) return new Response('No D1 database bound', { status: 500 });
  await ensureTable(db);
  const { results } = await db.prepare('SELECT date, value FROM capital_overrides').all();
  const map = {};
  for (const row of results || []) map[row.date] = row.value;
  return new Response(JSON.stringify(map), { headers: { 'Content-Type': 'application/json' } });
}

/* POST { date, value }  -> upsert (value set) or delete (value empty). Admin only. */
export async function onRequestPost({ request, env }) {
  const pw = request.headers.get('X-Admin-Password') || '';

  // Reuse the app's own /api/auth so we don't need to know the password var name
  let ok = false;
  try {
    const a = await fetch(new URL('/api/auth', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    ok = a.ok;
  } catch { ok = false; }
  if (!ok) return new Response('Unauthorized', { status: 401 });

  const db = getDB(env);
  if (!db) return new Response('No D1 database bound', { status: 500 });
  await ensureTable(db);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const date = body.date;
  const value = body.value;
  if (!date) return new Response('Missing date', { status: 400 });

  if (value === '' || value === null || value === undefined) {
    await db.prepare('DELETE FROM capital_overrides WHERE date = ?').bind(date).run();
  } else {
    await db.prepare(
      'INSERT INTO capital_overrides (date, value) VALUES (?, ?) ' +
      'ON CONFLICT(date) DO UPDATE SET value = excluded.value'
    ).bind(date, String(value)).run();
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
