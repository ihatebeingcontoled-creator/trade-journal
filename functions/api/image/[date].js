/**
 * GET  /api/image/:date  → serves image from R2 (public)
 * POST /api/image/:date  → uploads base64 image to R2 (admin only)
 *
 * R2 binding name: IMAGES
 * Expected env var: ADMIN_PASSWORD
 *
 * The frontend sends the image as a base64 data URL (data:image/jpeg;base64,...).
 * We strip the prefix and store raw binary in R2 to save space.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
};

function isAuthed(request, env) {
  return request.headers.get('X-Admin-Password') === env.ADMIN_PASSWORD;
}

/* ── GET: stream image from R2 ── */
export async function onRequestGet({ params, env }) {
  const key = `trade-${params.date}.jpg`;
  try {
    const obj = await env.IMAGES.get(key);
    if (!obj) {
      return new Response('Not found', { status: 404, headers: CORS });
    }
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
        ...CORS,
      },
    });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500, headers: CORS });
  }
}

/* ── POST: receive base64 data URL, decode, store in R2 ── */
export async function onRequestPost({ request, params, env }) {
  if (!isAuthed(request, env)) {
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }
  try {
    const body = await request.text();

    // Strip the data URL prefix: "data:image/jpeg;base64,<data>"
    const commaIdx = body.indexOf(',');
    const base64   = commaIdx >= 0 ? body.slice(commaIdx + 1) : body;

    // Decode base64 → binary
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const key = `trade-${params.date}.jpg`;
    await env.IMAGES.put(key, bytes.buffer, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
