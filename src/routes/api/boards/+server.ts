import { json, error } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashSecret } from '$lib/server/db';

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
  const now = new Date().toISOString();

  const { error: boardError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(secret),
    created_at: now,
    updated_at: now
  });
  if (boardError) {
    console.error('3tap create board failed', { code: boardError.code, message: boardError.message });
    throw error(500, boardError.message);
  }

  const habits = DEFAULT_HABITS.map((name, position) => ({
    id: randomUUID(),
    board_id: boardId,
    name,
    position
  }));

  const { error: habitsError } = await db.from('habits').insert(habits);
  if (habitsError) {
    console.error('3tap create habits failed', { code: habitsError.code, message: habitsError.message });
    throw error(500, habitsError.message);
  }

  return json({
    credentials: { boardId, secret },
    board: {
      id: boardId,
      createdAt: now,
      updatedAt: now,
      habits: habits.map(({ id, name, position }) => ({ id, name, position, createdAt: now })),
      archivedHabits: [],
      entries: []
    }
  });
}
