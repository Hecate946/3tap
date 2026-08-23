import { error, json, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db } from '$lib/server/db';
import { getBoard } from '$lib/server/board';

function etagFor(updatedAt: string | null | undefined) {
  return updatedAt ? `\"${updatedAt}\"` : null;
}

export async function GET(event: RequestEvent) {
  const { id } = event.params;
  const metadata = await assertBoard(event, id);
  const etag = etagFor(metadata.updated_at);

  if (etag && event.request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': 'private, no-store' }
    });
  }

  const board = await getBoard(id, metadata);
  return json(board, {
    headers: {
      ...(etag ? { etag } : {}),
      'cache-control': 'private, no-store'
    }
  });
}

export async function DELETE(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);

  const { error: deleteError } = await db.from('boards').delete().eq('id', id);
  if (deleteError) throw error(500, deleteError.message || 'Could not delete board');

  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'private, no-store' }
  });
}
