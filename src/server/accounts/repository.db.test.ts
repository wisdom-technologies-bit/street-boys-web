import { recentEvents } from '@/server/security/audit';
import { truncateAll } from '@/test/db-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CharacterAlreadyExistsError,
  DuplicateCharacterNameError,
  DuplicateEmailError,
  createCharacter,
  createUser,
  countCharacters,
  findUserByCanonicalEmail,
  setUserStatus,
} from './repository';

const AVATAR = { skinTone: 2, hair: 3, outfit: 4 } as const;

beforeEach(async () => {
  await truncateAll();
});

async function makeUser(email: string): Promise<string> {
  const { id } = await createUser({ email, emailCanonical: email.toLowerCase() });
  return id;
}

describe('createUser', () => {
  it('creates an account with the defaults the migration sets', async () => {
    const id = await makeUser('first@example.com');
    const found = await findUserByCanonicalEmail('first@example.com');

    expect(found?.id).toBe(id);
    expect(found?.status).toBe('active');
    expect(found?.verificationLevel).toBe(1);
  });

  it('refuses a second account with the same canonical email', async () => {
    await makeUser('taken@example.com');
    await expect(makeUser('taken@example.com')).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('returns null for an address nobody used', async () => {
    await expect(findUserByCanonicalEmail('nobody@example.com')).resolves.toBeNull();
  });
});

describe('createCharacter', () => {
  it('creates one character per account', async () => {
    const userId = await makeUser('player@example.com');
    await createCharacter({
      userId,
      name: 'Ada',
      nameCanonical: 'ada',
      avatar: AVATAR,
    });

    await expect(countCharacters(userId)).resolves.toBe(1);
  });

  it('refuses a name another player already has', async () => {
    const first = await makeUser('one@example.com');
    const second = await makeUser('two@example.com');

    await createCharacter({ userId: first, name: 'Ada', nameCanonical: 'ada', avatar: AVATAR });
    await expect(
      createCharacter({ userId: second, name: 'ADA', nameCanonical: 'ada', avatar: AVATAR }),
    ).rejects.toBeInstanceOf(DuplicateCharacterNameError);
  });

  it('refuses a second character for the same account, even under a race', async () => {
    const userId = await makeUser('race@example.com');

    const results = await Promise.allSettled([
      createCharacter({ userId, name: 'Ada', nameCanonical: 'ada', avatar: AVATAR }),
      createCharacter({ userId, name: 'Bola', nameCanonical: 'bola', avatar: AVATAR }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CharacterAlreadyExistsError,
    );
    await expect(countCharacters(userId)).resolves.toBe(1);
  });

  it('records the creation in the audit log without the name', async () => {
    const userId = await makeUser('audit@example.com');
    await createCharacter({ userId, name: 'Ada', nameCanonical: 'ada', avatar: AVATAR });

    const events = await recentEvents('character.created');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.metadata)).not.toContain('Ada');
  });
});

describe('setUserStatus', () => {
  it('changes the status and writes an audit entry', async () => {
    const userId = await makeUser('frozen@example.com');

    await setUserStatus({ userId, status: 'frozen', reason: 'chargeback' });

    const found = await findUserByCanonicalEmail('frozen@example.com');
    expect(found?.status).toBe('frozen');

    const events = await recentEvents('user.status_changed');
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({ status: 'frozen', reason: 'chargeback' });
  });

  it('refuses an unknown user', async () => {
    await expect(
      setUserStatus({ userId: '00000000-0000-0000-0000-000000000000', status: 'banned' }),
    ).rejects.toThrow(/No such user/);
  });
});
