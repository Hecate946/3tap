import { json, error } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashSecret } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

export async function POST() {
  const boardId = randomUUID();
  const secret = randomBytes(32).toString('base64url');

  const { error: boardError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(secret)
  });
  if (boardError) throw error(500, boardError.message);


  return json({
    credentials: { boardId, secret },
    board: await getBoard(boardId)
  });
}
