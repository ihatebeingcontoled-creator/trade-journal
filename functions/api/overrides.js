/* ──────────────────────────────────────────────────────────────────────────
   Capital Risked overrides  →  /api/overrides
   Save this as:  functions/api/overrides.js   (no edits needed)

   Stores your manual "Capital Risked" values in their own D1 table that your
   /api/sync never touches — so a Capital.com sync can't wipe them, and they
   follow you across every device.

   • Uses the same DB binding as the rest of the app (variable name: DB).
   • Reuses your existing ADMIN_PASSWORD env var — same as every other endpoint.
   • Creates its table automatically on first use (no migration to run).
   ────────────────────────────────────────────────────────────────────────── */

async function ensureTable(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS capital_overrides (date TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run();
}

/* GET -> { "YYYY-MM-DD": "1000", ... }  — public, no auth needed */
export async function onRequestGet({ env }) {
  if (!env.DB) return new Response('No D1 database bound', { status: 500 });
  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare('SELECT date, value FROM capital_overrides').all();
    const map = {};
    for (const row of results || []) map[row.date] = row.value;
    return new Response(JSON.stringify(map), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/* POST { date, value }  → upsert (value set) or delete (value empty). Admin only. */
export async function onRequestPost({ request, env }) {
  /* Auth: same pattern as trades.js / rules.js */
  const pw = request.headers.get('X-Admin-Password') || '';
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!env.DB) return new Response('No D1 database bound', { status: 500 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const date  = body.date;
  const value = body.value;
  if (!date) return new Response('Missing date', { status: 400 });

  try {
    await ensureTable(env.DB);

    if (value === '' || value === null || value === undefined) {
      await env.DB.prepare('DELETE FROM capital_overrides WHERE date = ?').bind(date).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO capital_overrides (date, value) VALUES (?, ?) ' +
        'ON CONFLICT(date) DO UPDATE SET value = excluded.value'
      ).bind(date, String(value)).run();
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
