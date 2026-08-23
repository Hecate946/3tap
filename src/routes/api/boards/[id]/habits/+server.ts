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

  const { data: existing, error: existingError } = await db
    .from('habits')
    .select('id, archived_at')
    .eq('board_id', id);
  if (existingError) throw error(500, existingError.message);

  const existingIds = new Set((existing ?? []).map((habit) => habit.id));
  const activeIds = new Set((existing ?? []).filter((habit) => !habit.archived_at).map((habit) => habit.id));
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const requested = cleaned.map((habit) => ({
    ...habit,
    id: existingIds.has(habit.id) || uuidPattern.test(habit.id) ? habit.id : randomUUID()
  }));

  const candidateNewIds = requested
    .map((habit) => habit.id)
    .filter((habitId) => !existingIds.has(habitId));

  let collisions = new Set<string>();
  if (candidateNewIds.length) {
    const { data: collidingRows, error: collisionError } = await db
      .from('habits')
      .select('id')
      .in('id', candidateNewIds);
    if (collisionError) throw error(500, collisionError.message);
    collisions = new Set((collidingRows ?? []).map((habit) => habit.id));
  }

  const safeCleaned = requested.map((habit) => ({
    ...habit,
    id: collisions.has(habit.id) ? randomUUID() : habit.id
  }));
  const incomingIds = new Set(safeCleaned.map((habit) => habit.id));
  const archivedNow = [...activeIds].filter((habitId) => !incomingIds.has(habitId));
  if (archivedNow.length) {
    const { error: archiveError } = await db
      .from('habits')
      .update({ archived_at: new Date().toISOString() })
      .eq('board_id', id)
      .in('id', archivedNow);
    if (archiveError) throw error(500, archiveError.message);
  }

  const rows = safeCleaned.map((habit, position) => ({
    id: habit.id,
    board_id: id,
    name: habit.name,
    position,
    archived_at: null
  }));

  if (rows.length) {
    const { error: upsertError } = await db.from('habits').upsert(rows, { onConflict: 'id' });
    if (upsertError) throw error(500, upsertError.message);
  }

  const now = new Date().toISOString();
  const { error: touchError } = await db.from('boards').update({ updated_at: now }).eq('id', id);
  if (touchError) throw error(500, touchError.message);

  return json(await getBoard(id));
}
