import { json, error } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashSecret } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

const DEFAULT_HABITS = [
  'run',
  'gym',
  'clarinet',
  'piano',
  'job / ta',
  'scholarships',
  'pickleball',
  'chinese'
];

export async function POST() {
  const boardId = randomUUID();
  const secret = randomBytes(32).toString('base64url');

  const { error: boardError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(secret)
  });
  if (boardError) throw error(500, boardError.message);

  const { error: habitsError } = await db.from('habits').insert(
    DEFAULT_HABITS.map((name, position) => ({
      id: randomUUID(),
      board_id: boardId,
      name,
      position
    }))
  );
  if (habitsError) throw error(500, habitsError.message);

  return json({
    credentials: { boardId, secret },
    board: await getBoard(boardId)
  });
}
