import { error } from '@sveltejs/kit';
import { db } from './db';
import type { Board, Habit, MarkValue } from '$lib/types';

type BoardMeta = { created_at: string; updated_at?: string | null };
type HabitRow = { id: string; name: string; position: number; created_at: string; archived_at: string | null };
type EntryRow = { habit_id: string; entry_date: string; value: number };

async function getHabits(boardId: string) {
  const { data, error: dbError } = await db.from('habits')
    .select('id, name, position, created_at, archived_at').eq('board_id', boardId).order('position');
  if (dbError) throw error(500, dbError.message);
  const mapped: Habit[] = ((data ?? []) as HabitRow[]).map(h => ({
    id: h.id, name: h.name, position: h.position, createdAt: h.created_at, archivedAt: h.archived_at ?? undefined
  }));
  return { habits: mapped.filter(h => !h.archivedAt), archivedHabits: mapped.filter(h => Boolean(h.archivedAt)) };
}

async function getEntries(boardId: string, since?: string): Promise<EntryRow[]> {
  const pageSize = 1000;
  const pageQuery = (from: number, withCount = false) => {
    let query = db.from('entries').select('habit_id, entry_date, value', withCount ? { count: 'exact' } : undefined).eq('board_id', boardId);
    if (since) query = query.gte('updated_at', since);
    else query = query.neq('value', 0);
    return query.order('updated_at').order('habit_id').order('entry_date').range(from, from + pageSize - 1);
  };
  const first = await pageQuery(0, !since);
  if (first.error) throw error(500, first.error.message);
  const rows = [...((first.data ?? []) as EntryRow[])];
  if (rows.length < pageSize) return rows;
  if (!since && typeof first.count === 'number') {
    const starts: number[] = [];
    for (let from = pageSize; from < first.count; from += pageSize) starts.push(from);
    for (let i = 0; i < starts.length; i += 4) {
      const batch = await Promise.all(starts.slice(i, i + 4).map(from => pageQuery(from)));
      for (const result of batch) {
        if (result.error) throw error(500, result.error.message);
        rows.push(...((result.data ?? []) as EntryRow[]));
      }
    }
    return rows;
  }
  for (let from = pageSize; ; from += pageSize) {
    const page = await pageQuery(from);
    if (page.error) throw error(500, page.error.message);
    const data = (page.data ?? []) as EntryRow[];
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

export async function getBoard(boardId: string, metadata?: BoardMeta, since?: string): Promise<Board> {
  const [boardResult, habitData, entries] = await Promise.all([
    metadata ? Promise.resolve({ data: metadata, error: null }) : db.from('boards').select('created_at, updated_at').eq('id', boardId).single(),
    getHabits(boardId),
    getEntries(boardId, since)
  ]);
  const { data: board, error: boardError } = boardResult;
  if (boardError || !board) throw error(500, boardError?.message ?? 'Board not found');
  return {
    createdAt: board.created_at,
    updatedAt: board.updated_at ?? undefined,
    ...habitData,
    entries: entries.map(e => ({ habitId: e.habit_id, date: e.entry_date, value: e.value as MarkValue })),
    ...(since ? { entriesDelta: true } : {})
  };
}
