import { error, json, type RequestEvent } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db, hashSecret, normalizeEmail } from '$lib/server/db';
import { sendPasswordResetEmail } from '$lib/server/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_RESPONSE = { ok: true, message: 'if that email has an account, a reset link is on the way' };

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { email?: unknown } | null;
  const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
  if (!EMAIL_RE.test(email) || email.length > 254) throw error(400, 'Enter a valid email address');

  // Opportunistically clear abandoned expired links; at most one live token exists per account.
  await db.from('password_reset_tokens').delete().lt('expires_at', new Date().toISOString());

  const { data: board, error: lookupError } = await db.from('boards')
    .select('id, email')
    .ilike('email', email)
    .maybeSingle();
  if (lookupError) {
    console.error('3tap password-reset account lookup failed:', lookupError);
    throw error(500, 'Could not start password reset');
  }

  // Always return the same response when an account is absent so this endpoint
  // cannot be used to discover which email addresses have 3tap accounts.
  if (!board?.id || !board.email) return json(GENERIC_RESPONSE, { headers: { 'cache-control': 'no-store' } });

  const { data: recent } = await db.from('password_reset_tokens')
    .select('created_at')
    .eq('board_id', board.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent?.created_at && Date.now() - new Date(recent.created_at).getTime() < 60_000) {
    return json(GENERIC_RESPONSE, { headers: { 'cache-control': 'no-store' } });
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  await db.from('password_reset_tokens').delete().eq('board_id', board.id);
  const { error: tokenError } = await db.from('password_reset_tokens').insert({
    board_id: board.id,
    token_hash: hashSecret(token),
    expires_at: expiresAt
  });
  if (tokenError) {
    console.error('3tap password-reset token creation failed:', tokenError);
    throw error(500, 'Could not start password reset');
  }

  const isLocal = event.url.hostname === 'localhost' || event.url.hostname === '127.0.0.1';
  const origin = isLocal ? event.url.origin : (env.APP_ORIGIN?.trim() || event.url.origin);
  const resetUrl = `${origin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendPasswordResetEmail(board.email, resetUrl);
  } catch (mailError) {
    await db.from('password_reset_tokens').delete().eq('board_id', board.id);
    console.error('3tap password-reset email failed:', mailError);
    throw error(503, 'Password reset email is temporarily unavailable');
  }

  return json(GENERIC_RESPONSE, { headers: { 'cache-control': 'no-store' } });
}
