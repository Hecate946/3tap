import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';

const DEFAULT_SUPABASE_URL = 'https://zxglxdnbkxlghssjppjh.supabase.co';

function requireEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = env[name] || (name === 'SUPABASE_URL' ? DEFAULT_SUPABASE_URL : '');
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

type DbClient = ReturnType<typeof createClient>;

let client: DbClient | undefined;

function getDb() {
  return client ??= createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}

export const db = new Proxy({} as DbClient, {
  get(_target, property) {
    const value = Reflect.get(getDb(), property);
    return typeof value === 'function' ? value.bind(getDb()) : value;
  }
});

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}


export function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createSession(boardId: string) {
  const token = randomBytes(32).toString('base64url');
  const { error: sessionError } = await db.from('board_sessions').insert({ board_id: boardId, token_hash: hashSecret(token) });
  if (sessionError) throw error(500, sessionError.message);
  return token;
}

export function readSecret(request: Request) {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw error(401, 'Missing board key');
  const secret = auth.slice(7).trim();
  if (!secret) throw error(401, 'Missing board key');
  return secret;
}

export async function assertBoard(event: RequestEvent, boardId: string) {
  const secret = readSecret(event.request);
  const { data, error: dbError } = await db
    .from('boards')
    .select('id, secret_hash, recovery_hash, created_at, updated_at')
    .eq('id', boardId)
    .maybeSingle();

  if (dbError) throw error(500, dbError.message);
  if (!data) throw error(404, 'Board not found');

  const actual = Buffer.from(hashSecret(secret), 'hex');
  const acceptedHashes = [data.secret_hash, data.recovery_hash].filter((value): value is string => typeof value === 'string' && value.length > 0);
  const valid = acceptedHashes.some((hash) => {
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
  if (!valid) {
    const { data: session, error: sessionError } = await db
      .from('board_sessions')
      .select('board_id')
      .eq('board_id', boardId)
      .eq('token_hash', hashSecret(secret))
      .maybeSingle();
    if (sessionError) throw error(500, sessionError.message);
    if (!session) throw error(401, 'Invalid session');
  }

  return data;
}

export function createAuthClient() {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validatePassword(password: string) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be 128 characters or fewer';
  return null;
}
