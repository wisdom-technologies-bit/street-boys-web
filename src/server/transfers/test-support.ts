import { canonicalizeName } from '@/server/accounts/character';
import { getPool } from '@/server/db/client';
import { createPlayerAccount, getBalance, postTransaction } from '@/server/ledger';
import { resetLedger, systemAccountId } from '@/server/ledger/test-support';

/**
 * Test scaffolding for transfers: real users, real characters, real wallets.
 *
 * A transfer needs four rows to exist before it can be attempted, so these helpers
 * write them the way the product does (through the ledger gate for the account) and
 * leave the assertions about money to the tests.
 */

let counter = 0;

export type TestPlayer = {
  userId: string;
  accountId: string;
  name: string;
  setName: (name: string) => Promise<void>;
};

export async function resetTransfers(): Promise<void> {
  await getPool().query(
    'truncate table transfers, audit_log, characters, sessions, auth_otps, rate_limits, users restart identity cascade',
  );
  await resetLedger();
}

export async function createPlayer(
  label: string,
  options: { ageDays?: number; verificationLevel?: number; status?: string } = {},
): Promise<TestPlayer> {
  counter += 1;
  const ageDays = options.ageDays ?? 40;
  const name = `${label} ${counter}`;
  const canonical = canonicalizeName(name);
  const createdAt = new Date(Date.now() - ageDays * 86_400_000);

  const { rows } = await getPool().query<{ id: string }>(
    `insert into users (email, email_canonical, status, verification_level, created_at, terms_accepted_at, terms_version)
     values ($1, $1, $2, $3, $4, now(), 'v1') returning id`,
    [
      `${canonical.replace(/\s+/g, '.')}@example.test`,
      options.status ?? 'active',
      options.verificationLevel ?? 1,
      createdAt,
    ],
  );
  const userId = rows[0]?.id as string;

  await getPool().query(
    `insert into characters (user_id, name, name_canonical, avatar) values ($1, $2, $3, '{}'::jsonb)`,
    [userId, name, canonical],
  );

  // The wallet is opened the way the product opens one: through the ledger.
  const accountId = (await createPlayerAccount(userId)).id;

  return {
    userId,
    accountId,
    name,
    setName: async (next: string) => {
      await getPool().query(
        'update characters set name = $2, name_canonical = $2 where user_id = $1',
        [userId, next.toLowerCase()],
      );
    },
  };
}

/** Put money in a wallet the way the game does: minted from SYSTEM_MINT. */
export async function fund(player: TestPlayer, kobo: bigint): Promise<void> {
  const mint = await systemAccountId('SYSTEM_MINT');
  await postTransaction({
    idempotencyKey: `grant:${player.userId}:${kobo}`,
    category: 'onboarding_grant',
    entries: [
      { accountId: mint, amountKobo: -kobo },
      { accountId: player.accountId, amountKobo: kobo },
    ],
  });
}

export async function balance(accountId: string): Promise<bigint> {
  return getBalance(accountId);
}

export async function transferCount(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>('select count(*) from transfers');
  return Number(rows[0]?.count ?? '0');
}
