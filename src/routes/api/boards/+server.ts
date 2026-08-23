import { json, error } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashSecret } from '$lib/server/db';
import { getBoard } from '$lib/server/board';
import { generateRecoveryCode } from '$lib/server/recovery';

export async function POST() {
  const boardId = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const recoveryCode = generateRecoveryCode();

  const { error: boardError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(secret),
    recovery_hash: hashSecret(recoveryCode)
  });
  if (boardError) throw error(500, boardError.message);

  return json({
    credentials: { boardId, secret, recoveryCode },
    board: await getBoard(boardId)
  });
}
