import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';

function requireEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export const db = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
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
    .select('id, secret_hash, created_at')
    .eq('id', boardId)
    .maybeSingle();

  if (dbError) throw error(500, dbError.message);
  if (!data) throw error(404, 'Board not found');

  const expected = Buffer.from(data.secret_hash, 'hex');
  const actual = Buffer.from(hashSecret(secret), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw error(401, 'Invalid board key');
  }

  return data;
}
