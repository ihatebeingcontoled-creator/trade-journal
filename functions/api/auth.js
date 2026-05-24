/**
 * POST /api/auth
 * Body: { password: string }
 * Returns 200 if password matches ADMIN_PASSWORD env var, 401 otherwise.
 * No data is read or written — purely an auth check.
 */
export async function onRequestPost({ request, env }) {
  try {
    const { password } = await request.json();
    if (password && password === env.ADMIN_PASSWORD) {
      return new Response('OK', { status: 200 });
    }
    return new Response('Unauthorized', { status: 401 });
  } catch {
    return new Response('Bad request', { status: 400 });
  }
}
