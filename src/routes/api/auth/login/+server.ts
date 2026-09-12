import { error, json, type RequestEvent } from '@sveltejs/kit';
import { createAuthClient, createSession, db, normalizeEmail } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) throw error(400, 'Email and password are required');

  const auth = createAuthClient();
  const { data: authData, error: authError } = await auth.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) throw error(401, 'Incorrect email or password');

  const { data, error: lookupError } = await db.from('boards')
    .select('id, email, display_name, created_at, updated_at')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (lookupError) throw error(500, lookupError.message);
  if (!data) throw error(404, 'Account data was not found');

  const secret = await createSession(data.id);
  return json({
    credentials: { boardId: data.id, secret, email: data.email ?? email, displayName: data.display_name ?? undefined },
    board: await getBoard(data.id, data)
  }, { headers: { 'cache-control': 'private, no-store' } });
}
