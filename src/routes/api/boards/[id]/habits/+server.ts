import { error, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);
  const body = await event.request.json().catch(() => null);
  const incoming = body?.habits;
  if (!Array.isArray(incoming) || incoming.length > 40) throw error(400, 'Invalid habits');
  const cleaned = incoming.map((habit: unknown) => {
    if (!habit || typeof habit !== 'object') throw error(400, 'Invalid habit');
    const item = habit as { id?: unknown; name?: unknown };
    const habitId = typeof item.id === 'string' ? item.id : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : '';
    if (!uuidPattern.test(habitId) || !name) throw error(400, 'Invalid habit');
    return { id: habitId, name };
  });

  const { data: existing, error: existingError } = await db.from('habits').select('id, archived_at').eq('board_id', id);
  if (existingError) throw error(500, existingError.message);
  const existingIds = new Set((existing ?? []).map(h => h.id));
  const activeIds = new Set((existing ?? []).filter(h => !h.archived_at).map(h => h.id));
  const candidateNewIds = cleaned.map(h => h.id).filter(habitId => !existingIds.has(habitId));
  if (candidateNewIds.length) {
    const { data: collisions, error: collisionError } = await db.from('habits').select('id').in('id', candidateNewIds);
    if (collisionError) throw error(500, collisionError.message);
    if ((collisions ?? []).length) throw error(409, 'Habit id collision');
  }

  const incomingIds = new Set(cleaned.map(h => h.id));
  const archivedNow = [...activeIds].filter(habitId => !incomingIds.has(habitId));
  const now = new Date().toISOString();
  if (archivedNow.length) {
    const { error: archiveError } = await db.from('habits').update({ archived_at: now }).eq('board_id', id).in('id', archivedNow);
    if (archiveError) throw error(500, archiveError.message);
  }
  if (cleaned.length) {
    const { error: upsertError } = await db.from('habits').upsert(cleaned.map((habit, position) => ({
      id: habit.id, board_id: id, name: habit.name, position, archived_at: null
    })), { onConflict: 'id' });
    if (upsertError) throw error(500, upsertError.message);
  }
  const { error: touchError } = await db.from('boards').update({ updated_at: now }).eq('id', id);
  if (touchError) throw error(500, touchError.message);
  return new Response(null, { status: 204 });
}

export async function DELETE(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);
  const now = new Date().toISOString();
  const { error: deleteError } = await db.from('habits').delete().eq('board_id', id).not('archived_at', 'is', null);
  if (deleteError) throw error(500, deleteError.message);
  const { error: touchError } = await db.from('boards').update({ updated_at: now }).eq('id', id);
  if (touchError) throw error(500, touchError.message);
  return new Response(null, { status: 204 });
}
