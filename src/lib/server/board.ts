import { error } from '@sveltejs/kit';
import { db } from './db';
import type { Board, Habit } from '$lib/types';

type BoardMeta = {
  id: string;
  created_at: string;
  updated_at?: string | null;
};

export async function getBoard(boardId: string, metadata?: BoardMeta): Promise<Board> {
  const [boardResult, habitsResult, entriesResult] = await Promise.all([
    metadata
      ? Promise.resolve({ data: metadata, error: null })
      : db.from('boards').select('id, created_at, updated_at').eq('id', boardId).single(),
    db
      .from('habits')
      .select('id, name, position, created_at, archived_at')
      .eq('board_id', boardId)
      .order('position'),
    db.from('entries').select('habit_id, entry_date, value, updated_at').eq('board_id', boardId)
  ]);

  const { data: board, error: boardError } = boardResult;
  const { data: habits, error: habitsError } = habitsResult;
  const { data: entries, error: entriesError } = entriesResult;

  if (boardError || !board) throw error(500, boardError?.message ?? 'Board not found');
  if (habitsError) throw error(500, habitsError.message);
  if (entriesError) throw error(500, entriesError.message);

  const mappedHabits: Habit[] = (habits ?? []).map((habit) => ({
    id: habit.id,
    name: habit.name,
    position: habit.position,
    createdAt: habit.created_at,
    archivedAt: habit.archived_at ?? undefined
  }));

  return {
    id: board.id,
    createdAt: board.created_at,
    updatedAt: board.updated_at ?? undefined,
    habits: mappedHabits.filter((habit) => !habit.archivedAt),
    archivedHabits: mappedHabits.filter((habit) => Boolean(habit.archivedAt)),
    entries: (entries ?? []).map((entry) => ({
      habitId: entry.habit_id,
      date: entry.entry_date,
      value: entry.value as 1 | 2,
      updatedAt: entry.updated_at
    }))
  };
}
