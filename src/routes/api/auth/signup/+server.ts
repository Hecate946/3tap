import { error, json, type RequestEvent } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { createAuthClient, createSession, db, hashSecret, normalizeEmail, validatePassword } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { email?: unknown; displayName?: unknown; password?: unknown } | null;
  const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 40) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw error(400, 'Enter a valid email address');
  const passwordError = validatePassword(password);
  if (passwordError) throw error(400, passwordError);

  const auth = createAuthClient();
  const { data: authData, error: authError } = await auth.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || null }, emailRedirectTo: event.url.origin }
  });
  if (authError) {
    const message = authError.message.toLowerCase();
    if (message.includes('registered') || message.includes('exists') || message.includes('already')) throw error(409, 'An account already exists for this email');
    throw error(400, authError.message);
  }
  if (!authData.user || (Array.isArray(authData.user.identities) && authData.user.identities.length === 0)) {
    throw error(409, 'An account already exists for this email');
  }

  const boardId = randomUUID();
  const legacySecret = randomBytes(32).toString('base64url');
  const { data, error: insertError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(legacySecret),
    auth_user_id: authData.user.id,
    email,
    display_name: displayName || null
  }).select('id, created_at, updated_at').single();
  if (insertError) {
    await auth.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
    if (insertError.code === '23505') throw error(409, 'An account already exists for this email');
    throw error(500, insertError.message);
  }

  if (!authData.session) {
    return json({ verificationRequired: true }, { status: 202, headers: { 'cache-control': 'private, no-store' } });
  }

  const secret = await createSession(boardId);
  return json({
    credentials: { boardId, secret, email, displayName: displayName || undefined },
    board: await getBoard(boardId, data)
  }, { headers: { 'cache-control': 'private, no-store' } });
}
