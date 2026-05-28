// GET  /api/rules  → public, returns [{id, text}, ...] ordered by id (1..10)
// POST /api/rules  → admin only, body = { rules: [{id, text}, ...] } — upserts all
//
// Uses the SAME bindings your trades API already uses:
//   DB              → your D1 database (trade-journal)
//   ADMIN_PASSWORD  → your admin password (env var / secret)

export async function onRequest(context) {
  const { request, env } = context;

  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // ── GET: public list of rules ─────────────────────────────
  if (request.method === "GET") {
    const { results } = await env.DB
      .prepare("SELECT id, text FROM rules ORDER BY id")
      .all();
    return new Response(JSON.stringify(results || []), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // ── POST: admin upsert of all rules ───────────────────────
  if (request.method === "POST") {
    const pw = request.headers.get("X-Admin-Password");
    if (!pw || pw !== env.ADMIN_PASSWORD) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400, headers: CORS });
    }

    const rules = Array.isArray(body) ? body : body.rules;
    if (!Array.isArray(rules)) {
      return new Response("Expected { rules: [...] }", { status: 400, headers: CORS });
    }

    const now = Date.now();
    const stmt = env.DB.prepare(
      "INSERT INTO rules (id, text, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at"
    );

    const batch = rules
      .filter((r) => r && Number.isInteger(r.id) && r.id >= 1 && r.id <= 10)
      .map((r) => stmt.bind(r.id, String(r.text ?? ""), now));

    if (batch.length) await env.DB.batch(batch);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  return new Response("Method not allowed", { status: 405, headers: CORS });
}
