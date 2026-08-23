import { json } from '@sveltejs/kit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as svelteEnv } from '$env/dynamic/private';

function readEnv(name: 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
  return (process.env[name] || svelteEnv[name] || '').trim();
}

export async function GET() {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  const result: Record<string, unknown> = {
    ok: false,
    runtime: 'cloudflare-worker',
    env: {
      supabaseUrl: Boolean(url),
      supabaseSecret: Boolean(key),
      urlLooksValid: /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url),
      secretLooksValid: key.startsWith('sb_secret_') || key.split('.').length === 3
    },
    database: {
      reachable: false,
      boardsTable: false,
      habitsTable: false,
      entriesTable: false
    }
  };

  if (!url || !key) {
    result.issue = 'missing-runtime-env';
    return json(result, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  let client: SupabaseClient;
  try {
    client = createClient(url.replace(/\/$/, ''), key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  } catch (error) {
    result.issue = 'invalid-supabase-config';
    result.detail = error instanceof Error ? error.message : 'Could not initialize Supabase client';
    return json(result, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const checks = [
    ['boardsTable', client.from('boards').select('id', { head: true, count: 'exact' }).limit(1)],
    ['habitsTable', client.from('habits').select('id', { head: true, count: 'exact' }).limit(1)],
    ['entriesTable', client.from('entries').select('board_id', { head: true, count: 'exact' }).limit(1)]
  ] as const;

  const responses = await Promise.all(checks.map(([, promise]) => promise));
  const database = result.database as Record<string, unknown>;
  database.reachable = responses.some((response) => !response.error || Boolean(response.status));

  let firstError: { message: string; code?: string } | null = null;
  responses.forEach((response, index) => {
    const name = checks[index][0];
    database[name] = !response.error;
    if (!firstError && response.error) {
      firstError = { message: response.error.message, code: response.error.code };
    }
  });

  if (firstError) {
    const message = firstError.message.toLowerCase();
    if (message.includes('invalid api key') || message.includes('jwt') || message.includes('unauthorized')) {
      result.issue = 'supabase-secret-rejected';
    } else if (message.includes('does not exist') || message.includes('schema cache')) {
      result.issue = 'schema-missing';
    } else {
      result.issue = 'supabase-query-failed';
    }
    result.detail = firstError;
    return json(result, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  result.ok = true;
  result.issue = null;
  return json(result, { headers: { 'cache-control': 'no-store' } });
}
