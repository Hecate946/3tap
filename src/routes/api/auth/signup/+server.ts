import { error, json, type RequestEvent } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { createSession, db, hashPassword, hashSecret, normalizeEmail, validatePassword, verifyPassword } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ExistingBoard = {
  id: string;
  email: string | null;
  password_hash: string | null;
  created_at: string;
  updated_at: string | null;
};

async function finishAccount(board: ExistingBoard, email: string) {
  const secret = await createSession(board.id);
  return json({
    credentials: { boardId: board.id, secret, email: board.email ?? email },
    board: await getBoard(board.id, board)
  }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw error(400, 'Enter a valid email address');
  const passwordError = validatePassword(password);
  if (passwordError) throw error(400, passwordError);

  const { data: existingData, error: lookupError } = await db.from('boards')
    .select('id, email, password_hash, created_at, updated_at')
    .ilike('email', email)
    .maybeSingle();
  if (lookupError) {
    console.error('3tap account lookup failed:', lookupError);
    throw error(500, 'Could not check account');
  }

  const existing = existingData as ExistingBoard | null;
  if (existing) {
    // Repair an account that an older 3tap build created before it managed to
    // create the first session. This remains safe because the password must match.
    const { data: sessions, error: sessionLookupError } = await db.from('board_sessions')
      .select('board_id').eq('board_id', existing.id).limit(1);
    if (sessionLookupError) {
      console.error('3tap incomplete-account check failed:', sessionLookupError);
      throw error(500, 'Could not check account');
    }
    if ((sessions?.length ?? 0) === 0 && existing.password_hash && verifyPassword(password, existing.password_hash)) {
      return finishAccount(existing, email);
    }
    throw error(409, 'An account already exists for this email');
  }

  const boardId = randomUUID();
  const deviceSecret = randomBytes(32).toString('base64url');
  const { data, error: insertError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(deviceSecret),
    recovery_hash: null,
    email,
    password_hash: hashPassword(password),
    auth_user_id: null
  }).select('id, email, password_hash, created_at, updated_at').single();
  if (insertError) {
    if (insertError.code === '23505') throw error(409, 'An account already exists for this email');
    console.error('3tap account creation failed:', insertError);
    throw error(500, 'Could not create account');
  }

  try {
    return await finishAccount(data as ExistingBoard, email);
  } catch (accountError) {
    const { error: cleanupError } = await db.from('boards').delete().eq('id', boardId);
    if (cleanupError) console.error('3tap failed signup cleanup failed:', cleanupError);
    throw accountError;
  }
}
