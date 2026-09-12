import { error, json, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, createSession, db, hashPassword, normalizeUsername } from '$lib/server/db';

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { boardId?: unknown; username?: unknown; password?: unknown } | null;
  const boardId = typeof body?.boardId === 'string' ? body.boardId : '';
  await assertBoard(event, boardId);
  const username = normalizeUsername(typeof body?.username === 'string' ? body.username : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (username.length < 3 || username.length > 24) throw error(400, 'Username must be 3–24 letters, numbers, or underscores');
  if (password.length < 8 || password.length > 128) throw error(400, 'Password must be at least 8 characters');
  const { error: updateError } = await db.from('boards').update({ username, password_hash: hashPassword(password), updated_at: new Date().toISOString() }).eq('id', boardId);
  if (updateError?.code === '23505') throw error(409, 'Username is taken');
  if (updateError) throw error(500, updateError.message);
  const secret = await createSession(boardId);
  return json({ credentials: { boardId, secret, username } }, { headers: { 'cache-control': 'private, no-store' } });
}
