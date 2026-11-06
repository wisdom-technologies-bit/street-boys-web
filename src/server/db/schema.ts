import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The only table in the baseline migration.
 *
 * It exists to prove the migration pipeline works end to end: generate, apply,
 * read back. Real tables (accounts, ledger) arrive with their own prompts.
 *
 * Rules for every table added later (AGENTS.md section 4): money is integer
 * kobo in `bigint` columns, ledger tables are append-only and are protected by
 * database triggers, and no personal data is stored without a reason.
 */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AppMeta = typeof appMeta.$inferSelect;
export type NewAppMeta = typeof appMeta.$inferInsert;
