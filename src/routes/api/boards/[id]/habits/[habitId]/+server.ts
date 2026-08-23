import { error, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';

export async function DELETE(event: RequestEvent) {
  const { id, habitId } = event.params;
  await assertBoard(event, id);
  if (!habitId) throw error(400, 'Missing habit');
  const { data, error: deleteError } = await db.from('habits').delete()
    .eq('board_id', id).eq('id', habitId).not('archived_at', 'is', null).select('id');
  if (deleteError) throw error(500, deleteError.message);
  if (!data?.length) throw error(404, 'Archived habit not found');
  const { error: touchError } = await db.from('boards').update({ updated_at: new Date().toISOString() }).eq('id', id);
  if (touchError) throw error(500, touchError.message);
  return new Response(null, { status: 204 });
}
