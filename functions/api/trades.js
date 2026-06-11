/**
 * GET  /api/trades  → returns all trades as JSON (public, no auth)
 * POST /api/trades  → upserts a trade (requires X-Admin-Password header)
 *
 * D1 binding name: DB
 * Expected env var: ADMIN_PASSWORD
 *
 * Required columns (run add-notes-columns.sql once if upgrading):
 *   date, profit, percent, capital, rr, trades, market,
 *   nBefore, nEntry, nClose, nAfter, nSummary, hasImage
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

/* ── GET: return all trades as { 'YYYY-MM-DD': {...}, ... } ── */
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM trades').all();
    const out = {};
    for (const row of results) {
      out[row.date] = {
        date:     row.date,
        profit:   row.profit   ?? '',
        percent:  row.percent  ?? '',
        capital:  row.capital  ?? '',
        rr:       row.rr       ?? '',
        trades:   row.trades   ?? '',
        market:   row.market   ?? '',
        nBefore:  row.nBefore  ?? '',
        nEntry:   row.nEntry   ?? '',
        nClose:   row.nClose   ?? '',
        nAfter:   row.nAfter   ?? '',
        nSummary: row.nSummary ?? '',
        byMarket: row.byMarket ?? '',
        hasImage: !!row.hasImage,
      };
    }
    return json(out);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

/* ── POST: upsert a trade (admin only) ── */
export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const t = await request.json();
    if (!t.date) return json({ error: 'Missing date' }, 400);

    await env.DB.prepare(`
      INSERT INTO trades (date, profit, percent, capital, rr, trades, market, nBefore, nEntry, nClose, nAfter, nSummary, hasImage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        profit   = excluded.profit,
        percent  = excluded.percent,
        capital  = excluded.capital,
        rr       = excluded.rr,
        trades   = excluded.trades,
        market   = excluded.market,
        nBefore  = excluded.nBefore,
        nEntry   = excluded.nEntry,
        nClose   = excluded.nClose,
        nAfter   = excluded.nAfter,
        nSummary = excluded.nSummary,
        hasImage = excluded.hasImage
    `).bind(
      t.date,
      t.profit   ?? '',
      t.percent  ?? '',
      t.capital  ?? '',
      t.rr       ?? '',
      t.trades   ?? '',
      t.market   ?? '',
      t.nBefore  ?? '',
      t.nEntry   ?? '',
      t.nClose   ?? '',
      t.nAfter   ?? '',
      t.nSummary ?? '',
      t.hasImage ? 1 : 0,
    ).run();

    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
