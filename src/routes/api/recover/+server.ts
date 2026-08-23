import { error, json, type RequestEvent } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { db, hashSecret } from '$lib/server/db';
import { getBoard } from '$lib/server/board';
import { normalizeRecoveryCode } from '$lib/server/recovery';

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { code?: unknown } | null;
  const recoveryCode = normalizeRecoveryCode(typeof body?.code === 'string' ? body.code : '');
  if (!recoveryCode) throw error(400, 'Enter a recovery code');

  const recoveryHash = hashSecret(recoveryCode);
  const { data: boardMeta, error: lookupError } = await db
    .from('boards')
    .select('id, created_at, updated_at')
    .eq('recovery_hash', recoveryHash)
    .maybeSingle();

  if (lookupError) throw error(500, lookupError.message || 'Could not check recovery code');
  if (!boardMeta) throw error(404, 'Recovery code not found');
  const secret = randomBytes(32).toString('base64url');
  const updatedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from('boards')
    .update({ secret_hash: hashSecret(secret), updated_at: updatedAt })
    .eq('id', boardMeta.id);

  if (updateError) throw error(500, updateError.message || 'Could not recover board');

  return json(
    {
      credentials: { boardId: boardMeta.id, secret, recoveryCode },
      board: await getBoard(boardMeta.id, { ...boardMeta, updated_at: updatedAt })
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
