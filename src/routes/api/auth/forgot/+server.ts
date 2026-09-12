import { json, type RequestEvent } from '@sveltejs/kit';
import { createAuthClient, normalizeEmail } from '$lib/server/db';

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { email?: unknown } | null;
  const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
  if (email) {
    const auth = createAuthClient();
    const redirectTo = `${event.url.origin}/reset-password`;
    await auth.auth.resetPasswordForEmail(email, { redirectTo }).catch(() => undefined);
  }
  return json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}
