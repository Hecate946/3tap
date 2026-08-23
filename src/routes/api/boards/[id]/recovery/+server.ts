import { error, json, type RequestEvent } from '@sveltejs/kit';
import { assertBoard, db, hashSecret } from '$lib/server/db';
import { generateRecoveryCode } from '$lib/server/recovery';

export async function POST(event: RequestEvent) {
  const { id } = event.params;
  await assertBoard(event, id);

  const recoveryCode = generateRecoveryCode();
  const { error: updateError } = await db
    .from('boards')
    .update({
      recovery_hash: hashSecret(recoveryCode),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (updateError) throw error(500, updateError.message || 'Could not create recovery code');

  return json(
    { recoveryCode },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
