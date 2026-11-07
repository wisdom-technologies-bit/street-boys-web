import { z } from 'zod';
import { checkAvatar, checkCharacterName } from '@/server/accounts/character';
import {
  CharacterAlreadyExistsError,
  DuplicateCharacterNameError,
  createCharacter,
} from '@/server/accounts/repository';
import { findSessionUser } from '@/server/accounts/session';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { clientIpFrom, errorResponse, guardMutation, jsonResponse } from '@/server/http/guard';

/**
 * POST /api/character
 *
 * One character per account, created once. The rules live in
 * `accounts/character.ts` and the write lives in the repository, so this route
 * only decides the order of checks and the shape of the answer.
 *
 * Concurrency: the database has a unique index on `characters.user_id`, so two
 * requests racing each other produce one character and one `already_has_character`
 * rather than two characters.
 *
 * There is deliberately no name-availability endpoint: a live "is this name free"
 * check turns character creation into a way to enumerate names, and the answer
 * would be stale by the time the player typed the next letter.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ATTEMPTS_PER_HOUR = 10;

const bodySchema = z.object({
  name: z.string().min(1).max(64),
  avatar: z.unknown(),
});

export async function POST(request: Request): Promise<Response> {
  const guard = guardMutation(request);
  if (!guard.ok) return guard.response;

  const user = await findSessionUser(request);
  if (!user) return errorResponse('unauthorized');
  if (user.status !== 'active') return errorResponse('forbidden');

  const limited = await consumeRateLimit(`character:user:${user.id}`, ATTEMPTS_PER_HOUR, 3600);
  if (!limited.allowed) {
    return errorResponse('rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_request');
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return errorResponse('invalid_request');

  const nameCheck = checkCharacterName(parsed.data.name);
  if (!nameCheck.ok) return errorResponse('name_not_allowed');

  const avatarCheck = checkAvatar(parsed.data.avatar);
  if (!avatarCheck.ok) return errorResponse('avatar_invalid');

  try {
    await createCharacter({
      userId: user.id,
      name: nameCheck.name,
      nameCanonical: nameCheck.canonical,
      avatar: avatarCheck.avatar,
      ipHash: clientIpFrom(request),
    });
  } catch (error) {
    if (error instanceof DuplicateCharacterNameError) return errorResponse('name_taken');
    if (error instanceof CharacterAlreadyExistsError) {
      return errorResponse('already_has_character');
    }
    throw error;
  }

  return jsonResponse({ name: nameCheck.name, avatar: avatarCheck.avatar }, 201);
}
