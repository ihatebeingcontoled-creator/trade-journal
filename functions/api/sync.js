// =================================================================
//  /api/sync  —  pull closed trades from Capital.com into D1
// -----------------------------------------------------------------
//  - Admin only (same X-Admin-Password check as the other endpoints)
//  - Reads realized P&L from Capital.com /history/transactions
//  - Aggregates per calendar day -> one journal row per day
//  - Fills ONLY the factual fields: profit, percent, capital,
//    trades (count), market. Leaves your notes (before/entry/close/
//    after/summary), rr and any uploaded image completely untouched.
//  - Re-running is safe: each day is recomputed from scratch and
//    replaced, so nothing double-counts.
//  - If a day has a Capital Risked override saved in capital_overrides,
//    Capital.com CANNOT change the capital or percent for that day.
//
//  Required environment variables (Pages > Settings > Variables):
//    CAP_API_KEY      your Capital.com API key
//    CAP_IDENTIFIER   your Capital.com login email
//    CAP_PASSWORD     the password for the API key
//                     (the custom API password if you set one,
//                      otherwise your normal account password)
//  Optional:
//    CAP_DEMO         "1" / "true"  -> use the demo environment
//    CAP_ACCOUNT_ID   switch to a specific financial account
//    CAP_LOOKBACK_DAYS default window to pull (default 30)
// =================================================================

const LIVE_BASE = 'https://api-capital.backend-capital.com';
const DEMO_BASE = 'https://demo-api-capital.backend-capital.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
         `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
      },
    });
  }

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  // ---- Admin auth ----
  const pw = request.headers.get('X-Admin-Password') || '';
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  // ---- Config ----
  if (!env.CAP_API_KEY || !env.CAP_IDENTIFIER || !env.CAP_PASSWORD) {
    return json({
      ok: false,
      error: 'Missing Capital.com credentials. Add CAP_API_KEY, CAP_IDENTIFIER and CAP_PASSWORD in Pages > Settings > Variables.',
    }, 500);
  }

  const isDemo = /^(1|true|yes)$/i.test(env.CAP_DEMO || '');
  const BASE = isDemo ? DEMO_BASE : LIVE_BASE;

  let days = parseInt(env.CAP_LOOKBACK_DAYS || '30', 10);
  try {
    const u = new URL(request.url);
    if (u.searchParams.get('days')) days = parseInt(u.searchParams.get('days'), 10);
    if (request.method === 'POST') {
      const ct = request.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const body = await request.json().catch(() => ({}));
        if (body && body.days) days = parseInt(body.days, 10);
      }
    }
  } catch (_) {}
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (days > 1000) days = 1000;

  try {
    // ---- 1. Open a session ----
    const sessRes = await fetch(`${BASE}/api/v1/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CAP-API-KEY': env.CAP_API_KEY,
      },
      body: JSON.stringify({
        identifier: env.CAP_IDENTIFIER,
        password: env.CAP_PASSWORD,
        encryptedPassword: false,
      }),
    });

    if (!sessRes.ok) {
      const t = await sessRes.text().catch(() => '');
      return json({ ok: false, error: `Capital.com login failed (${sessRes.status}). ${t}`.trim() }, 502);
    }

    const cst = sessRes.headers.get('CST');
    const xsec = sessRes.headers.get('X-SECURITY-TOKEN');
    const sess = await sessRes.json().catch(() => ({}));
    const authHeaders = { 'CST': cst, 'X-SECURITY-TOKEN': xsec };

    let balance = sess?.accountInfo?.balance;
    let currency = sess?.currencyIsoCode || 'USD';

    // ---- optional: switch to a specific account ----
    if (env.CAP_ACCOUNT_ID && env.CAP_ACCOUNT_ID !== sess?.currentAccountId) {
      await fetch(`${BASE}/api/v1/session`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ accountId: env.CAP_ACCOUNT_ID }),
      }).catch(() => {});
      const accRes = await fetch(`${BASE}/api/v1/accounts`, { headers: authHeaders });
      if (accRes.ok) {
        const accs = await accRes.json().catch(() => ({}));
        const match = (accs.accounts || []).find((a) => a.accountId === env.CAP_ACCOUNT_ID);
        if (match) { balance = match.balance?.balance; currency = match.currency || currency; }
      }
    }

    // ---- 2. Pull transaction history (chunked) ----
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    const CHUNK = 30;
    const allTx = [];

    for (let cursor = new Date(start); cursor < now; cursor = new Date(cursor.getTime() + CHUNK * 86400000)) {
      const to = new Date(Math.min(cursor.getTime() + CHUNK * 86400000, now.getTime()));
      const qs = `from=${encodeURIComponent(fmtDate(cursor))}&to=${encodeURIComponent(fmtDate(to))}`;
      const txRes = await fetch(`${BASE}/api/v1/history/transactions?${qs}`, { headers: authHeaders });
      if (txRes.ok) {
        const data = await txRes.json().catch(() => ({}));
        if (Array.isArray(data.transactions)) allTx.push(...data.transactions);
      }
      await sleep(220);
    }

    // ---- 3. Keep realized trade closes only, group by local calendar day ----
    const byDay = {};
    for (const tx of allTx) {
      if (tx.transactionType !== 'TRADE') continue;
      const dateStr = (tx.date || tx.dateUtc || '').slice(0, 10);
      if (!dateStr) continue;
      const amt = parseFloat(tx.size);
      if (isNaN(amt)) continue;
      if (!byDay[dateStr]) byDay[dateStr] = { profit: 0, count: 0, markets: new Set(), byMarket: {} };
      byDay[dateStr].profit += amt;
      byDay[dateStr].count += 1;
      if (tx.instrumentName) byDay[dateStr].markets.add(tx.instrumentName);
      // per-instrument realized P&L + trade count so stats can be filtered by market
      const inst = tx.instrumentName || 'Unknown';
      if (!byDay[dateStr].byMarket[inst]) byDay[dateStr].byMarket[inst] = { pnl: 0, n: 0 };
      byDay[dateStr].byMarket[inst].pnl += amt;
      byDay[dateStr].byMarket[inst].n   += 1;
    }

    const syncedDays = Object.keys(byDay).sort();
    if (syncedDays.length === 0) {
      return json({ ok: true, days: 0, trades: 0, balance, currency, updated: [],
        message: 'No closed trades found in the selected window.' });
    }
    const mostRecent = syncedDays[syncedDays.length - 1];

    // ---- 4. Read existing rows + capital overrides ----
    const existingRows = await env.DB.prepare('SELECT * FROM trades').all();
    const existing = {};
    for (const r of (existingRows.results || [])) existing[r.date] = r;

    // Load user's locked capital overrides — Capital.com must never overwrite these
    let overrides = {};
    try {
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS capital_overrides (date TEXT PRIMARY KEY, value TEXT NOT NULL)'
      ).run();
      const ovRows = await env.DB.prepare('SELECT date, value FROM capital_overrides').all();
      for (const r of (ovRows.results || [])) overrides[r.date] = r.value;
    } catch (_) { /* treat as no overrides if table missing */ }

    // ---- 5. Merge + upsert ----
    const stmt = env.DB.prepare(
      `INSERT OR REPLACE INTO trades
        (date, profit, percent, capital, rr, trades, market,
         nBefore, nEntry, nClose, nAfter, nSummary, hasImage, byMarket)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    const batch = [];
    let totalTrades = 0;

    for (const date of syncedDays) {
      const d = byDay[date];
      const prev = existing[date] || {};
      totalTrades += d.count;

      const profit = d.profit.toFixed(2);
      const market = Array.from(d.markets).sort().join(', ');

      const hasOverride = date in overrides;

      // capital: if the user has locked an override for this day, Capital.com cannot
      // touch this column. Otherwise update normally (most recent day = current balance).
      let capital = (prev.capital ?? '') + '';
      if (!hasOverride) {
        if (date === mostRecent && balance != null) capital = Number(balance).toFixed(2);
      }

      // percent: if override exists, recalculate using the user's locked capital value
      // so the calendar cell always matches the modal. Capital.com's balance is ignored.
      let percent = (prev.percent ?? '') + '';
      if (hasOverride) {
        const overrideCap = parseFloat(overrides[date]);
        if (!isNaN(overrideCap) && overrideCap > 0) {
          percent = (d.profit / overrideCap * 100).toFixed(2);
        }
      } else {
        const capNum = parseFloat(capital);
        if (!isNaN(capNum) && capNum > 0) percent = (d.profit / capNum * 100).toFixed(2);
        else percent = '';
      }

      batch.push(stmt.bind(
        date,
        profit,
        percent,
        capital,
        (prev.rr ?? '') + '',           // preserved
        String(d.count),
        market,
        (prev.nBefore ?? '') + '',      // preserved
        (prev.nEntry ?? '') + '',       // preserved
        (prev.nClose ?? '') + '',       // preserved
        (prev.nAfter ?? '') + '',       // preserved
        (prev.nSummary ?? '') + '',     // preserved
        prev.hasImage ? 1 : 0,          // preserved
        JSON.stringify(d.byMarket)      // per-instrument P&L breakdown
      ));
    }

    await env.DB.batch(batch);

    return json({
      ok: true,
      env: isDemo ? 'demo' : 'live',
      days: syncedDays.length,
      trades: totalTrades,
      balance,
      currency,
      from: fmtDate(start).slice(0, 10),
      to: fmtDate(now).slice(0, 10),
      updated: syncedDays,
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
