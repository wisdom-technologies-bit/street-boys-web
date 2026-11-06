# src/test

**Purpose:** The shared test harness: environment loading, a database that is rebuilt from migrations, and cleanup between tests.
**Status:** Working. Used by `npm run test:db`; the ledger tests will reuse it.

## What is here

| File | What it does |
|---|---|
| `db-global-setup.ts` | Once per run: drops the schema, recreates it, applies every migration from `./drizzle` |
| `db-setup.ts` | Per test file: loads env and points `DATABASE_URL` at `DATABASE_URL_TEST`, so code under test can never reach a real database |
| `db-utils.ts` | `truncateAll()` empties every public table between tests, discovering tables at runtime so a new table is cleaned automatically |

## Rules

- **`DATABASE_URL_TEST` must point at a disposable database.** The harness drops the schema. Never point it at anything you want to keep.
- **Unit tests and database tests stay separate.** `npm run test` is fast and runs anywhere; `npm run test:db` needs Postgres.
- **Never weaken, skip or delete a test to make CI pass.** A failing test is information. If a test is wrong, fix it in its own commit and say why.
- **No production data in tests**, ever, and no real phone numbers or personal data in fixtures.
