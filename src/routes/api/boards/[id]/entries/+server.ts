import { json, error, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function PUT(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);

  const body = await event.request.json().catch(() => null);
  const habitId = body?.habitId;
  const date = body?.date;
  const value = body?.value;

  if (typeof habitId !== 'string' || !validDate(date) || ![0, 1, 2].includes(value)) {
    throw error(400, 'Invalid entry');
  }

  const { data: habit } = await db
    .from('habits')
    .select('id')
    .eq('id', habitId)
    .eq('board_id', id)
    .maybeSingle();
  if (!habit) throw error(404, 'Habit not found');

  if (value === 0) {
    const { error: deleteError } = await db
      .from('entries')
      .delete()
      .eq('board_id', id)
      .eq('habit_id', habitId)
      .eq('entry_date', date);
    if (deleteError) throw error(500, deleteError.message);
  } else {
    const { error: upsertError } = await db.from('entries').upsert(
      {
        board_id: id,
        habit_id: habitId,
        entry_date: date,
        value,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'board_id,habit_id,entry_date' }
    );
    if (upsertError) throw error(500, upsertError.message);
  }

  return json({ ok: true });
}
