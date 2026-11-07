import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Avatar } from '@/server/config/avatar-options';

/**
 * The schema.
 *
 * House rules (AGENTS.md sections 4 and 7):
 *
 * - **No money here, and none in accounts.** A player's balance belongs to the
 *   ledger, which arrives with its own prompt. A `schema.test.ts` fails the build
 *   if a column in an accounts table ever grows a money-shaped name.
 * - **Append-only is enforced by the database**, not by convention: triggers on
 *   `audit_log` refuse UPDATE and DELETE. TRUNCATE is left alone because the test
 *   harness drops and recreates the schema.
 * - **No personal data without a reason.** There is no name, no address and no
 *   date of birth: an email, an age band, and hashes of an IP.
 * - Every timestamp is `timestamptz`. A naive timestamp in a product used from
 *   one timezone and hosted in another is a bug waiting to be reported.
 */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    emailCanonical: text('email_canonical').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    /** 1 = email proven. A phone tier may raise this later (D-138). */
    verificationLevel: integer('verification_level').notNull().default(1),
    ageBand: text('age_band'),
    termsVersion: text('terms_version'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_canonical_key').on(t.emailCanonical),
    check('users_status_check', sql`${t.status} in ('active', 'frozen', 'banned')`),
    check('users_verification_level_check', sql`${t.verificationLevel} >= 1`),
    check('users_age_band_check', sql`${t.ageBand} in ('under_18', '18_plus')`),
  ],
);

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    nameCanonical: text('name_canonical').notNull(),
    avatar: jsonb('avatar').$type<Avatar>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('characters_user_id_key').on(t.userId),
    uniqueIndex('characters_name_canonical_key').on(t.nameCanonical),
  ],
);

export const authOtps = pgTable(
  'auth_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emailCanonical: text('email_canonical').notNull(),
    /** SHA-256 of the code. The code itself is never stored. */
    codeHash: text('code_hash').notNull(),
    ipHash: text('ip_hash'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_otps_email_created_idx').on(t.emailCanonical, t.createdAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** SHA-256 of the bearer token. A database read does not yield a session. */
    tokenHash: text('token_hash').notNull(),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Sliding expiry, moved forward on use. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Hard ceiling: no session outlives this, however active it is. */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash)],
);

export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [uniqueIndex('rate_limits_key_window_key').on(t.key, t.windowStart)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    eventType: text('event_type').notNull(),
    subject: text('subject'),
    ipHash: text('ip_hash'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('audit_log_event_type_at_idx').on(t.eventType, t.at)],
);

/** The baseline table that proves the migration pipeline. */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type AppMeta = typeof appMeta.$inferSelect;
export type NewAppMeta = typeof appMeta.$inferInsert;

/**
 * The ledger.
 *
 * Money lives here and nowhere else (AGENTS.md 3.1): every amount is a `bigint`
 * of kobo, in Drizzle `mode: 'bigint'`, so TypeScript sees a bigint rather than
 * the number that `.mode: 'number'` would give and silently round. The database
 * enforces what the module promises: balances cannot go below zero unless the
 * account is allowed to, the ledger cannot be edited or deleted, and a balance is
 * written only while the ledger module has opened the gate
 * (`SET LOCAL app.ledger_write = 'on'`). `drizzle/0002_ledger.sql` is the
 * authority; this file mirrors it.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    /** System, treasury and escrow accounts are looked up by this code. */
    code: text('code').unique(),
    /** A player has exactly one account. */
    ownerUserId: uuid('owner_user_id').unique(),
    /** SYSTEM_MINT only: it holds the money supply as a negative balance. */
    allowNegative: boolean('allow_negative').notNull().default(false),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('accounts_kind_check', sql`${table.kind} in ('player', 'system', 'treasury', 'escrow')`),
  ],
);

export const accountBalances = pgTable('account_balances', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id),
  balanceKobo: bigint('balance_kobo', { mode: 'bigint' }).notNull().default(0n),
  version: bigint('version', { mode: 'bigint' }).notNull().default(0n),
  allowNegative: boolean('allow_negative').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerTransactions = pgTable('ledger_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  requestFingerprint: text('request_fingerprint').notNull(),
  category: text('category').notNull(),
  actorUserId: uuid('actor_user_id'),
  reversesTransactionId: uuid('reverses_transaction_id').unique(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntries = pgTable('ledger_entries', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => ledgerTransactions.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  /** Signed: positive increases the account, negative decreases it. */
  amountKobo: bigint('amount_kobo', { mode: 'bigint' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
