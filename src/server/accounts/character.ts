import { z } from 'zod';
import { containsBlockedWord } from '@/server/config/blocked-words';
import { isReservedName } from '@/server/config/reserved-names';
import {
  AVATAR_HAIR_STYLES,
  AVATAR_OUTFITS,
  AVATAR_SKIN_TONES,
  type Avatar,
} from '@/server/config/avatar-options';

/**
 * Character names and avatars: the rules, in one place, so the API and the
 * database cannot disagree about what a valid name is.
 *
 * The reserved and blocked checks run on the **canonical** form, which is what
 * the unique index is on as well. `Sys_tem`, `sys tem` and `SYSTEM` are all the
 * canonical `system`, and all three are refused.
 */

export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 20;

export type NameRejection =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'leading_or_trailing_space'
  | 'double_space'
  | 'reserved'
  | 'blocked_word';

export type NameCheck =
  | { ok: true; name: string; canonical: string }
  | { ok: false; reason: NameRejection; message: string };

/** Lowercase, with spaces and underscores removed. */
export function canonicalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '');
}

/**
 * Validate a display name.
 *
 * Allowed: ASCII letters, digits, single spaces and underscores. Not allowed:
 * anything that collides with a reserved name or a blocked word once the
 * separators are gone.
 */
export function checkCharacterName(raw: string): NameCheck {
  const name = raw ?? '';

  if (name.trim().length === 0) {
    return { ok: false, reason: 'empty', message: 'Choose a name.' };
  }

  if (name !== name.trim()) {
    return {
      ok: false,
      reason: 'leading_or_trailing_space',
      message: 'A name cannot start or end with a space.',
    };
  }

  if (name.length < NAME_MIN_LENGTH) {
    return { ok: false, reason: 'too_short', message: 'Use at least 3 characters.' };
  }

  if (name.length > NAME_MAX_LENGTH) {
    return { ok: false, reason: 'too_long', message: 'Use at most 20 characters.' };
  }

  if (!/^[A-Za-z0-9 _]+$/.test(name)) {
    return {
      ok: false,
      reason: 'invalid_characters',
      message: 'Use letters, numbers, spaces and underscores only.',
    };
  }

  if (/ {2,}/.test(name)) {
    return { ok: false, reason: 'double_space', message: 'Use single spaces only.' };
  }

  const canonical = canonicalizeName(name);

  if (isReservedName(canonical)) {
    return { ok: false, reason: 'reserved', message: 'That name is reserved.' };
  }

  if (containsBlockedWord(canonical)) {
    return { ok: false, reason: 'blocked_word', message: 'That name is not allowed.' };
  }

  return { ok: true, name, canonical };
}

const avatarSchema = z.object({
  skinTone: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  hair: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
  ]),
  outfit: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
  ]),
});

export type AvatarCheck =
  { ok: true; avatar: Avatar } | { ok: false; reason: 'invalid_avatar'; message: string };

/** Validate an avatar: ids from the fixed lists only, nothing free-form. */
export function checkAvatar(input: unknown): AvatarCheck {
  const parsed = avatarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_avatar',
      message: 'Choose a skin tone, hair style and outfit from the options.',
    };
  }
  return { ok: true, avatar: parsed.data };
}

/** The option ids, for a client that renders the picker from the server. */
export const AVATAR_CHOICES = {
  skinTone: AVATAR_SKIN_TONES,
  hair: AVATAR_HAIR_STYLES,
  outfit: AVATAR_OUTFITS,
} as const;
