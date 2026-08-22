import { json, error, type RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { assertBoard, db } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

export async function PUT(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);

  const body = await event.request.json().catch(() => null);
  const incoming = body?.habits;
  if (!Array.isArray(incoming) || incoming.length > 40) throw error(400, 'Invalid habits');

  const cleaned = incoming
    .map((habit: unknown) => {
      if (!habit || typeof habit !== 'object') return null;
      const item = habit as { id?: unknown; name?: unknown };
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
      if (!name) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : randomUUID(),
        name
      };
    })
    .filter(Boolean) as { id: string; name: string }[];

  if (cleaned.length === 0) throw error(400, 'Keep at least one habit');

  const { data: existing, error: existingError } = await db
    .from('habits')
    .select('id')
    .eq('board_id', id);
  if (existingError) throw error(500, existingError.message);

  const existingIds = new Set((existing ?? []).map((habit) => habit.id));
  const safeCleaned = cleaned.map((habit) => ({
    ...habit,
    id: existingIds.has(habit.id) ? habit.id : randomUUID()
  }));
  const incomingIds = new Set(safeCleaned.map((habit) => habit.id));
  const removedIds = [...existingIds].filter((habitId) => !incomingIds.has(habitId));

  if (removedIds.length) {
    const { error: deleteError } = await db.from('habits').delete().eq('board_id', id).in('id', removedIds);
    if (deleteError) throw error(500, deleteError.message);
  }

  const rows = safeCleaned.map((habit, position) => ({
    id: habit.id,
    board_id: id,
    name: habit.name,
    position
  }));

  const { error: upsertError } = await db.from('habits').upsert(rows, { onConflict: 'id' });
  if (upsertError) throw error(500, upsertError.message);

  const now = new Date().toISOString();
  const { error: touchError } = await db.from('boards').update({ updated_at: now }).eq('id', id);
  if (touchError) throw error(500, touchError.message);

  return json(await getBoard(id));
}
