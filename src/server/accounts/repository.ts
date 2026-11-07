import { eq, sql } from 'drizzle-orm';
import type { Avatar } from '@/server/config/avatar-options';
import { getDb } from '@/server/db/client';
import { characters, users } from '@/server/db/schema';
import { logEvent, subjectForEmail } from '@/server/security/audit';

/**
 * The only place accounts are written.
 *
 * Every function is a single attempt and a typed refusal. The database decides
 * whether something is a duplicate, so two simultaneous requests cannot both
 * "check then insert" and both succeed.
 */

export class DuplicateEmailError extends Error {
  constructor() {
    super('That email address is already registered.');
    this.name = 'DuplicateEmailError';
  }
}

export class DuplicateCharacterNameError extends Error {
  constructor() {
    super('That name is taken.');
    this.name = 'DuplicateCharacterNameError';
  }
}

export class CharacterAlreadyExistsError extends Error {
  constructor() {
    super('This account already has a character.');
    this.name = 'CharacterAlreadyExistsError';
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('No such user.');
    this.name = 'UserNotFoundError';
  }
}

export type UserStatus = 'active' | 'frozen' | 'banned';
export type AgeBand = 'under_18' | '18_plus';

function isUniqueViolation(error: unknown, constraint: string): boolean {
  // Drizzle wraps the driver error, so the pg code and constraint name sit on the
  // cause chain. Walk it rather than trusting the outermost message.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as {
      code?: string;
      constraint?: string;
      message?: string;
      cause?: unknown;
    };
    if (candidate.code === '23505') {
      if (candidate.constraint === constraint) return true;
      if (candidate.message?.includes(constraint)) return true;
    }
    current = candidate.cause;
  }
  return false;
}

export type CreateUserInput = {
  email: string;
  emailCanonical: string;
  ageBand?: AgeBand;
  termsVersion?: string;
  ipHash?: string | null;
  emailVerified?: boolean;
};

export async function createUser(input: CreateUserInput): Promise<{ id: string }> {
  const now = new Date();
  let row: { id: string };

  try {
    const inserted = await getDb()
      .insert(users)
      .values({
        email: input.email,
        emailCanonical: input.emailCanonical,
        ageBand: input.ageBand ?? null,
        termsVersion: input.termsVersion ?? null,
        termsAcceptedAt: input.termsVersion ? now : null,
        emailVerifiedAt: input.emailVerified ? now : null,
      })
      .returning({ id: users.id });
    row = inserted[0]!;
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_canonical_key')) throw new DuplicateEmailError();
    throw error;
  }

  await logEvent({
    actorUserId: row.id,
    eventType: 'user.created',
    subject: subjectForEmail(input.emailCanonical),
    ipHash: input.ipHash ?? null,
    // `verified`, not `emailVerified`: the audit guard refuses any key containing
    // "email", and it is right to, so the key is named for the fact it holds.
    metadata: { ageBand: input.ageBand ?? null, verified: Boolean(input.emailVerified) },
  });

  return row;
}

export async function findUserByCanonicalEmail(emailCanonical: string): Promise<{
  id: string;
  email: string;
  emailCanonical: string;
  status: UserStatus;
  verificationLevel: number;
} | null> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      emailCanonical: users.emailCanonical,
      status: users.status,
      verificationLevel: users.verificationLevel,
    })
    .from(users)
    .where(eq(users.emailCanonical, emailCanonical))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, status: row.status as UserStatus };
}

export async function setUserStatus(input: {
  userId: string;
  status: UserStatus;
  actorUserId?: string | null;
  reason?: string;
}): Promise<void> {
  const updated = await getDb()
    .update(users)
    .set({ status: input.status })
    .where(eq(users.id, input.userId))
    .returning({ id: users.id });

  if (updated.length === 0) throw new UserNotFoundError();

  await logEvent({
    actorUserId: input.actorUserId ?? null,
    eventType: 'user.status_changed',
    subject: input.userId,
    metadata: { status: input.status, reason: input.reason ?? null },
  });
}

export type CreateCharacterInput = {
  userId: string;
  name: string;
  nameCanonical: string;
  avatar: Avatar;
  ipHash?: string | null;
};

export async function createCharacter(input: CreateCharacterInput): Promise<{ id: string }> {
  let row: { id: string };

  try {
    const inserted = await getDb()
      .insert(characters)
      .values({
        userId: input.userId,
        name: input.name,
        nameCanonical: input.nameCanonical,
        avatar: input.avatar,
      })
      .returning({ id: characters.id });
    row = inserted[0]!;
  } catch (error) {
    if (isUniqueViolation(error, 'characters_name_canonical_key')) {
      throw new DuplicateCharacterNameError();
    }
    if (isUniqueViolation(error, 'characters_user_id_key')) {
      throw new CharacterAlreadyExistsError();
    }
    throw error;
  }

  await logEvent({
    actorUserId: input.userId,
    eventType: 'character.created',
    subject: input.userId,
    ipHash: input.ipHash ?? null,
    metadata: { characterId: row.id },
  });

  return row;
}

export async function countCharacters(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(characters)
    .where(eq(characters.userId, userId));
  return rows[0]?.count ?? 0;
}

/** The one character an account is allowed, or null. */
export async function findCharacterByUserId(
  userId: string,
): Promise<{ id: string; name: string; avatar: Avatar } | null> {
  const rows = await getDb()
    .select({ id: characters.id, name: characters.name, avatar: characters.avatar })
    .from(characters)
    .where(eq(characters.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, avatar: row.avatar as Avatar };
}
