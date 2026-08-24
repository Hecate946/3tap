import { error, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);
  const body = await event.request.json().catch(() => null);
  const incoming = body?.thoughts;
  if (!Array.isArray(incoming) || incoming.length > 200) throw error(400, 'Invalid thoughts');

  const cleaned = incoming.map((thought: unknown) => {
    if (!thought || typeof thought !== 'object') throw error(400, 'Invalid thought');
    const item = thought as { id?: unknown; text?: unknown };
    const thoughtId = typeof item.id === 'string' ? item.id : '';
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, 240) : '';
    if (!uuidPattern.test(thoughtId) || !text) throw error(400, 'Invalid thought');
    return { id: thoughtId, text };
  });

  const { data: existing, error: existingError } = await db.from('thoughts').select('id').eq('board_id', id);
  if (existingError) throw error(500, existingError.message);
  const existingIds = new Set((existing ?? []).map(thought => thought.id));
  const candidateNewIds = cleaned.map(thought => thought.id).filter(thoughtId => !existingIds.has(thoughtId));
  if (candidateNewIds.length) {
    const { data: collisions, error: collisionError } = await db.from('thoughts').select('id').in('id', candidateNewIds);
    if (collisionError) throw error(500, collisionError.message);
    if ((collisions ?? []).length) throw error(409, 'Thought id collision');
  }

  const incomingIds = new Set(cleaned.map(thought => thought.id));
  const removedIds = [...existingIds].filter(thoughtId => !incomingIds.has(thoughtId));
  if (removedIds.length) {
    const { error: deleteError } = await db.from('thoughts').delete().eq('board_id', id).in('id', removedIds);
    if (deleteError) throw error(500, deleteError.message);
  }

  const now = new Date().toISOString();
  if (cleaned.length) {
    const { error: upsertError } = await db.from('thoughts').upsert(cleaned.map((thought, position) => ({
      id: thought.id,
      board_id: id,
      text: thought.text,
      position,
      updated_at: now
    })), { onConflict: 'id' });
    if (upsertError) throw error(500, upsertError.message);
  }

  const { error: touchError } = await db.from('boards').update({ updated_at: now }).eq('id', id);
  if (touchError) throw error(500, touchError.message);
  return new Response(null, { status: 204 });
}
