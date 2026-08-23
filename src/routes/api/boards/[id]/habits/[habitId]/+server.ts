import { error, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';

export async function DELETE(event: RequestEvent) {
  const { id, habitId } = event.params;
  await assertBoard(event, id);
  if (!habitId) throw error(400, 'Missing habit');

  const { data: habit, error: habitError } = await db
    .from('habits')
    .select('id, archived_at')
    .eq('board_id', id)
    .eq('id', habitId)
    .maybeSingle();
  if (habitError) throw error(500, habitError.message);
  if (!habit) throw error(404, 'Habit not found');
  if (!habit.archived_at) throw error(409, 'Archive the habit before deleting it');

  // Touch the board *before* deleting. If the board write is unavailable, the
  // habit remains intact instead of being deleted and then returning an error.
  // The timestamp also invalidates other devices' conditional board cache.
  const { error: touchError } = await db
    .from('boards')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);
  if (touchError) throw error(500, touchError.message);

  const { error: deleteError } = await db
    .from('habits')
    .delete()
    .eq('board_id', id)
    .eq('id', habitId);
  if (deleteError) throw error(500, deleteError.message);

  // The client already updates Archive optimistically and then reconciles with
  // the canonical board. Avoid a second post-delete database read here so a
  // successful delete can never be reported as failed by unrelated response work.
  return new Response(null, { status: 204 });
}
