import { error, json, type RequestEvent } from '@sveltejs/kit';
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
  // The account key is itself a durable bearer credential. Do not rotate the
  // board's device secret when another device logs in; existing devices should
  // keep working and syncing.


  return json(
    {
      credentials: { boardId: boardMeta.id, secret: recoveryCode, recoveryCode },
      board: await getBoard(boardMeta.id, boardMeta)
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
