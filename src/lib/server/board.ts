import { error } from '@sveltejs/kit';
import { db } from './db';
import type { Board } from '$lib/types';

export async function getBoard(boardId: string): Promise<Board> {
  const [{ data: board, error: boardError }, { data: habits, error: habitsError }, { data: entries, error: entriesError }] =
    await Promise.all([
      db.from('boards').select('id, created_at').eq('id', boardId).single(),
      db.from('habits').select('id, name, position').eq('board_id', boardId).order('position'),
      db.from('entries').select('habit_id, entry_date, value, updated_at').eq('board_id', boardId)
    ]);

  if (boardError) throw error(500, boardError.message);
  if (habitsError) throw error(500, habitsError.message);
  if (entriesError) throw error(500, entriesError.message);

  return {
    id: board.id,
    createdAt: board.created_at,
    habits: (habits ?? []).map((habit) => ({
      id: habit.id,
      name: habit.name,
      position: habit.position
    })),
    entries: (entries ?? []).map((entry) => ({
      habitId: entry.habit_id,
      date: entry.entry_date,
      value: entry.value as 1 | 2,
      updatedAt: entry.updated_at
    }))
  };
}
