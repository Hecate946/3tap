import { json, type RequestEvent } from '@sveltejs/kit';
import { assertBoard } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

export async function GET(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);
  return json(await getBoard(id));
}
