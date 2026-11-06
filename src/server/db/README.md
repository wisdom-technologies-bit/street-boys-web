# src/server/db

**Purpose:** The Drizzle client, the schema, and the boundary between the application and Postgres.
**Status:** Working. `schema.ts` holds the baseline `app_meta` table; `client.ts` holds the pooled client.

## What is here

| File | What it does |
|---|---|
| `client.ts` | Lazily creates one `pg` pool and one Drizzle client, cached on `globalThis` so a warm serverless instance or a dev hot reload does not open a new pool |
| `schema.ts` | The Drizzle schema. Today that is `app_meta`, which exists only to prove migrations work |
| `migrations.db.test.ts` | Proves the migrations build the schema from an empty database |

## Migrations

- SQL migrations live in `./drizzle`, generated with `npm run db:generate` and applied with `npm run db:migrate`.
- **Never `drizzle-kit push`.** Migrations only, so the schema has a history that can be reviewed and replayed.
- The test harness (`src/test/db-global-setup.ts`) drops the schema and applies every migration, so CI proves an empty database can be built.

## Rules from AGENTS.md (sections 3 and 4)

- **Postgres only.** No second database, no cache, no JSON file as a store.
- **Drizzle only.** No second ORM, no raw string-concatenated SQL; parameterized queries or Drizzle's builder.
- **Money is integer kobo** in `bigint` columns, never a float and never naira.
- **Ledger tables are append-only**, enforced by database triggers, and are added only by the ledger prompt.
- **No personal data without a reason**, and no personal data in logs (NDPA: collect the minimum).
- **No connection string, credential or secret in code.** `DATABASE_URL` from the environment, names only in `.env.example`.
