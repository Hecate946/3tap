import { json, error, type RequestEvent } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, hashSecret } from '$lib/server/db';
import { generateRecoveryCode } from '$lib/server/recovery';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(event: RequestEvent) {
  const body = (await event.request.json().catch(() => null)) as { boardId?: unknown; secret?: unknown; createdAt?: unknown } | null;
  const requestedId = typeof body?.boardId === 'string' && uuidPattern.test(body.boardId) ? body.boardId : null;
  const requestedSecret = typeof body?.secret === 'string' && body.secret.length >= 32 ? body.secret : null;
  const boardId = requestedId ?? randomUUID();
  const secret = requestedSecret ?? randomBytes(32).toString('base64url');
  const recoveryCode = generateRecoveryCode();
  const createdAt = typeof body?.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt)) ? body.createdAt : new Date().toISOString();

  const { data, error: boardError } = await db.from('boards').insert({
    id: boardId,
    secret_hash: hashSecret(secret),
    recovery_hash: hashSecret(recoveryCode),
    created_at: createdAt
  }).select('created_at, updated_at').single();

  if (boardError) {
    if (boardError.code !== '23505' || !requestedId || !requestedSecret) throw error(500, boardError.message);
    const { data: existing, error: lookupError } = await db.from('boards')
      .select('secret_hash, created_at, updated_at').eq('id', boardId).maybeSingle();
    if (lookupError) throw error(500, lookupError.message);
    if (!existing || existing.secret_hash !== hashSecret(secret)) throw error(409, 'Board id collision');
    const updatedAt = new Date().toISOString();
    const { error: recoveryError } = await db.from('boards')
      .update({ recovery_hash: hashSecret(recoveryCode), updated_at: updatedAt }).eq('id', boardId);
    if (recoveryError) throw error(500, recoveryError.message);
    return json({
      credentials: { boardId, secret, recoveryCode },
      board: { createdAt: existing.created_at, updatedAt, habits: [], archivedHabits: [], thoughts: [], entries: [] }
    });
  }

  return json({
    credentials: { boardId, secret, recoveryCode },
    board: { createdAt: data.created_at, updatedAt: data.updated_at, habits: [], archivedHabits: [], thoughts: [], entries: [] }
  });
}
