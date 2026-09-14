import { error, json, type RequestEvent } from '@sveltejs/kit';
import { createSession, db, normalizeEmail, verifyPassword } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) throw error(400, 'Email and password are required');

  const { data, error: lookupError } = await db.from('boards')
    .select('id, email, password_hash, created_at, updated_at')
    .ilike('email', email)
    .maybeSingle();
  if (lookupError) throw error(500, 'Could not log in');
  if (!data?.password_hash || !verifyPassword(password, data.password_hash)) throw error(401, 'Incorrect email or password');

  const secret = await createSession(data.id);
  return json({
    credentials: { boardId: data.id, secret, email: data.email ?? email },
    board: await getBoard(data.id, data)
  }, { headers: { 'cache-control': 'private, no-store' } });
}
