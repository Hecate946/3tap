import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as svelteEnv } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';

function serverEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = (process.env[name] || svelteEnv[name] || '').trim();
  if (!value) {
    throw new Error(
      `${name} is missing at runtime. Add it to Cloudflare Worker > Settings > Variables and Secrets.`
    );
  }
  return value;
}

let client: SupabaseClient | null = null;

function getDb() {
  if (!client) {
    client = createClient(
      serverEnv('SUPABASE_URL').replace(/\/$/, ''),
      serverEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );
  }
  return client;
}

export const db = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const database = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = database[property];
    return typeof value === 'function' ? value.bind(database) : value;
  }
});

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
    .select('id, secret_hash, created_at, updated_at')
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
