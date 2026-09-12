import { error, json, type RequestEvent } from '@sveltejs/kit';
import { createAuthClient, db, validatePassword } from '$lib/server/db';

export async function POST(event: RequestEvent) {
  const authHeader = event.request.headers.get('authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!accessToken) throw error(401, 'Reset link is missing or expired');
  const body = (await event.request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  const passwordError = validatePassword(password);
  if (passwordError) throw error(400, passwordError);

  const auth = createAuthClient();
  const { data, error: userError } = await auth.auth.getUser(accessToken);
  if (userError || !data.user) throw error(401, 'Reset link is invalid or expired');
  const { error: updateError } = await auth.auth.admin.updateUserById(data.user.id, { password });
  if (updateError) throw error(400, updateError.message);

  const { data: board } = await db.from('boards').select('id').eq('auth_user_id', data.user.id).maybeSingle();
  if (board?.id) await db.from('board_sessions').delete().eq('board_id', board.id);
  await auth.auth.admin.signOut(accessToken, 'global').catch(() => undefined);
  return json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}
