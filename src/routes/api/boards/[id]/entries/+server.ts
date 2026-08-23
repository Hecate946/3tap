import { error, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';

type Change = { habitId: string; date: string; value: 0 | 1 | 2 };
function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function cleanChange(value: unknown): Change | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.habitId !== 'string' || !validDate(item.date) || ![0,1,2].includes(item.value as number)) return null;
  return { habitId: item.habitId, date: item.date, value: item.value as 0 | 1 | 2 };
}

export async function PUT(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);
  const body = await event.request.json().catch(() => null);
  const rawChanges = Array.isArray(body?.changes) ? body.changes : [body];
  if (rawChanges.length < 1 || rawChanges.length > 200) throw error(400, 'Invalid changes');
  const byCell = new Map<string, Change>();
  for (const raw of rawChanges) {
    const change = cleanChange(raw);
    if (!change) throw error(400, 'Invalid entry');
    byCell.set(`${change.habitId}\u0000${change.date}`, change);
  }
  const changes = [...byCell.values()];
  const habitIds = [...new Set(changes.map(c => c.habitId))];
  const { data: habits, error: habitsError } = await db.from('habits').select('id').eq('board_id', id).in('id', habitIds);
  if (habitsError) throw error(500, habitsError.message);
  if ((habits ?? []).length !== habitIds.length) throw error(404, 'Habit not found');
  const now = new Date().toISOString();
  const { error: upsertError } = await db.from('entries').upsert(changes.map(c => ({
    board_id: id, habit_id: c.habitId, entry_date: c.date, value: c.value, updated_at: now
  })), { onConflict: 'board_id,habit_id,entry_date' });
  if (upsertError) throw error(500, upsertError.message);
  const { error: touchError } = await db.from('boards').update({ updated_at: now }).eq('id', id);
  if (touchError) throw error(500, touchError.message);
  return new Response(null, { status: 204 });
}
