import { error, json, type RequestEvent } from '@sveltejs/kit';
import { db, hashPassword, hashSecret, validatePassword } from '$lib/server/db';

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!token) throw error(400, 'Reset link is invalid');
  const passwordError = validatePassword(password);
  if (passwordError) throw error(400, passwordError);

  const now = new Date().toISOString();
  const { data: reset, error: lookupError } = await db.from('password_reset_tokens')
    .select('board_id, expires_at')
    .eq('token_hash', hashSecret(token))
    .gt('expires_at', now)
    .maybeSingle();
  if (lookupError) {
    console.error('3tap password-reset token lookup failed:', lookupError);
    throw error(500, 'Could not reset password');
  }
  if (!reset?.board_id) throw error(400, 'Reset link is invalid or expired');

  const { error: updateError } = await db.from('boards').update({
    password_hash: hashPassword(password),
    updated_at: now
  }).eq('id', reset.board_id);
  if (updateError) {
    console.error('3tap password reset failed:', updateError);
    throw error(500, 'Could not reset password');
  }

  // Password changes invalidate every existing login and every outstanding
  // reset link. The user signs in again with the new password.
  const { error: sessionError } = await db.from('board_sessions').delete().eq('board_id', reset.board_id);
  if (sessionError) console.error('3tap reset session cleanup failed:', sessionError);
  await db.from('password_reset_tokens').delete().eq('board_id', reset.board_id);

  return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
