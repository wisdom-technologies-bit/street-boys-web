# Street Boys — web

**Purpose:** The Next.js application for Street Boys: screens, API routes, scheduled jobs, and later the ledger. This repository currently contains the **project foundation only**.
**Status:** Foundation (prompt `web-01`). No game features, no accounts, no auth, no ledger logic and no payments yet.

## What this is

Street Boys is a browser-based Nigerian street-life simulation: haggling, jobs, contracts, property and a city that keeps moving while you are away. The design lives in a separate repository, [`street-boys-docs`](https://github.com/wisdom-technologies-bit/street-boys-docs). **If this repository and that one disagree, that one wins.**

What exists today: a Next.js app on the App Router, TypeScript in strict mode, Drizzle with SQL migrations against Postgres, a health endpoint, a test harness that runs migrations against a real database, and CI that runs all of it.

## Requirements

| Tool     | Version                                                         |
| -------- | --------------------------------------------------------------- |
| Node     | **24** (see `.nvmrc`; `package.json` `engines` agrees)          |
| npm      | 10 or newer                                                     |
| Postgres | **15 or newer**, for `npm run test:db` and for a real local run |

## Run it locally

```bash
nvm use                 # picks up .nvmrc
npm install
cp .env.example .env.local     # then fill in DATABASE_URL (names only in the repo)
npm run db:migrate             # apply migrations to your database
npm run dev                    # http://localhost:3000
```

Check that it is alive:

```bash
curl -s localhost:3000/api/health
# { "status": "ok", "db": "ok", "version": "0.1.0" }
```

## Tests

```bash
npm run test       # unit tests. Fast, no database, runs anywhere
npm run test:db    # integration tests. Needs DATABASE_URL_TEST and a real Postgres
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

`test:db` **drops the public schema** of whatever `DATABASE_URL_TEST` points at, then applies every migration from scratch. Point it at a disposable database and nothing else.

The harness lives in `src/test/`. The ledger tests will reuse it unchanged.

## Migrations

The schema is defined in `src/server/db/schema.ts` and changes reach the database **only through migrations**:

```bash
npm run db:generate   # writes a new SQL file into drizzle/ from a schema change
npm run db:migrate    # applies any pending migrations
```

Rules: migrations are forward-only, they are committed with the code that needs them, and they are reviewed as **Level 3**. Never `drizzle-kit push`, never a hand-run query, never a direct edit to a shared database. CI proves an empty database can be built by the migrations alone.

### Migrations are a pre-deploy step, never a startup step

`npm run db:migrate` is run by the platform **before** the new version starts serving traffic, and by a human before a local run. It is never imported by the app and never called from a route handler. A migration that runs on request runs on every cold start, and eventually runs twice at once.

The script takes a **Postgres advisory lock** (`src/server/db/migrate.ts`) so two deploys starting together cannot migrate simultaneously: the second waits, then finds nothing left to do. The lock is released in a `finally`, and a session-scoped advisory lock also dies with its connection, so a killed deploy cannot wedge the next one. If the lock cannot be taken within 60 seconds the deploy fails with a clear message rather than hanging.

```bash
npm run db:migrate    # node --experimental-strip-types scripts/migrate.ts
npm run build:migrate # bundles it to dist/migrate.mjs, for an image with production deps only
npm run db:migrate:prod # node dist/migrate.mjs, the same migration from the bundle
```

Node runs the script's TypeScript directly, so a deploy needs no build step and no extra dependency. The script prints the outcome and the duration; it never prints a connection string, host or user.

## Ledger

The ledger is the only place money exists. It lives in `src/server/ledger` and
nothing else may write to its tables (AGENTS.md 3.2). This section is for someone
who needs to understand the rules, not the code.

**Money is stored as whole kobo.** ₦1 is 100 kobo, so ₦1,250.50 is `125050`. It is
stored as a `bigint` and never as a decimal number, because 10 kobo is not a value
a computer can hold exactly as a fraction. Nothing in the product divides by 100
except the formatter that shows a player their balance.

**Four kinds of account.**

| Kind       | What it is                                            |
| ---------- | ----------------------------------------------------- |
| `player`   | One per player. Holds what they earned.               |
| `system`   | Two fixed accounts: `SYSTEM_MINT` and `SYSTEM_BURN`   |
| `treasury` | Government money: taxes, licences, fines, remittances |
| `escrow`   | Money held for a deal that has not finished           |

**Money is created in one place and destroyed in one place.** `SYSTEM_MINT` is the
only account that may hold a negative balance, and its balance is the total money
in the game, written as a negative. Paying a player from it creates money.
`SYSTEM_BURN` is where destroyed money goes and never goes negative; a player
buying food destroys money by paying it. No other account can go below zero.

**What the database guarantees, in plain English.**

- Every movement has at least two entries and they add up to exactly zero, checked
  when the transaction commits. Money cannot appear or vanish inside a movement.
- Nothing in the ledger can be edited or deleted, ever. A mistake is fixed by
  posting the reverse entry, so the history always says what really happened.
- A balance can only change while the ledger module has opened its gate, so a
  stray script or a dashboard cannot quietly edit someone's money.
- An account cannot go below zero unless it is `SYSTEM_MINT`, and the database
  itself refuses, not just the code.

**Rules for any other module that moves money.**

1. Call `postTransaction` from `@/server/ledger`. Never touch the ledger tables.
2. Always pass an idempotency key derived from the action, such as
   `pay:<job-session-id>`. A retry then moves money once, not twice.
3. Always handle `InsufficientFunds`. A player can always be short, and that is a
   normal answer, not an error to crash on.

**Idempotency keys name an action, not an attempt.** Two rules, both enforced:

- **A retry MUST reuse the same key.** That is what makes it a retry: the second call
  finds the key and replays the original result instead of paying twice.
- **A different operation MUST use a different key.** `buildIdempotencyKey(namespace, ...parts)`
  builds one deterministically, for example `job-shift:<shiftId>`, so the same action
  always produces the same key and two actions cannot collide.

A key is 8 to 128 characters of `A-Z a-z 0-9 : _ . -`; anything else is refused at the
call site with a typed error rather than stored. Metadata is **not** part of what a key
identifies: replaying a key with the same entries but different metadata returns the
original transaction, unchanged, because the money is the intent and the note is not.
The same key with **different entries** is a bug at the call site and throws
`IdempotencyConflict`, changing nothing.

**Nothing writes a ledger row without the module.** A transaction and every entry in
it can only be inserted while the ledger module has opened its gate
(`app.ledger_write`); the database refuses everything else with "ledger rows are
written only by the ledger module". This is aimed at accidents: a repair script, a
migration, a dashboard, a future agent deciding to "just add the starting grant
here". It is **not** a defence against the table owner, who can disable a trigger or
set the setting themselves. That boundary needs a least-privilege database role,
which is a later task; until then the verifier is what notices.

### Reversals

Money is never edited. A mistake is undone by **reversing the transaction**, which
posts a new transaction whose entries are the exact negation of the original's, in
category `reversal`, with `reverses_transaction_id` pointing at what it undid. Both
facts stay in the history: what happened, and that it was undone, by whom, and why.

- **Once only.** `reverses_transaction_id` is unique in the database, so two
  simultaneous reversal attempts cannot both succeed. A reversal of a reversal is
  refused: undoing an undo is a new forward transaction with its own reason.
- **Never below zero.** If the money has already been spent, the reversal is refused
  with `InsufficientFundsForReversal` and **nothing is written.** What happens to the
  shortfall is a product decision that is still open (see docs/13).
- **Attributed.** An actor and a non-empty reason (at most 500 characters) are
  required and stored in the transaction's metadata.
- **Frozen accounts still owe.** A frozen account cannot spend, but it must be able
  to give money back, so a reversal (or an admin adjustment) may pass
  `allowFrozenDebit` **only with an actor**, and every use writes a
  `ledger_frozen_debit_override` audit event. **Who is allowed to ask for this is an
  authorization question that belongs to the admin prompt, not to this module**;
  until then the option exists, is audited, and is not exposed to any player.

### The verifier

`verifyLedger()` checks the ledger against itself: every transaction balances and has
at least two entries, the whole ledger sums to zero, every balance equals its entries,
every version equals its entry count, no account without permission is negative, every
account has a balance and every balance an account, the three system accounts exist,
and every reversal points at a real transaction whose negation it exactly is.

It reads inside one `REPEATABLE READ READ ONLY` transaction, so a report describes one
moment even while players are earning, and it returns **ids and counts only** — enough
to investigate, nothing personal.

```bash
npm run ledger:verify   # exit 0 when the ledger is sound, 1 when it is not
```

The same check is available to a scheduler at `POST /api/internal/ledger/verify`
(protected by `CRON_SECRET`, once per 30 seconds, audited as `ledger_verify_run`, or
`ledger_verify_failed` when it fails). To run it on a schedule, point the platform's
cron at that URL with the secret as a bearer token — the schedule is deliberately left
to the owner (D-150):

| Platform       | Where the schedule goes                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Railway        | a cron service, `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/internal/ledger/verify`                                   |
| Render         | a cron job with the same command                                                                                                                        |
| Vercel         | `crons` in `vercel.json`, `{"path": "/api/internal/ledger/verify", "schedule": "0 * * * *"}` (Vercel sends the secret itself when `CRON_SECRET` is set) |
| GitHub Actions | a scheduled workflow calling the same URL                                                                                                               |

### What to do if the verifier fails

1. **Stop money features.** Do not deploy anything that moves money, and do not
   "fix the balance" by hand: the ledger is append-only, and a hand edit destroys the
   only record of what went wrong.
2. **Keep the output.** The report names the failing checks and up to 20 ids per
   check. Copy it somewhere durable before anything else runs, including notifications.
3. **Investigate by id, read-only.** Start from the sample ids with the read
   functions: the transaction, its entries, the account's entries. The first entry that
   does not explain itself is usually the bug.
4. **Correct forward, never backward.** Once the cause is understood, the fix is a new
   transaction (or a reversal), posted through the module, so the history keeps both
   the fault and the repair.
5. **Ask before deciding money is lost.** A failing `balance_mismatch` means the
   stored balance disagrees with the entries; the entries are the truth. Whether a
   balance is rebuilt or an account is frozen is the owner's decision, not the agent's.

### Reports

`getMoneySupply()` returns circulating money, net minted, net burned, and the totals
held by players, the treasury and escrow, plus account counts — all `bigint` kobo.
`circulating = totalMinted - totalBurned` always holds, because every balance in the
ledger sums to zero; a test fails if it ever stops.

`getFlowsByCategory({ from, to })` returns, per day and per category, how much money was
created and destroyed. A reversal is attributed to the **original** transaction's
category, so a mint that was reversed reads as zero instead of leaving a "reversal"
bucket that looks like a faucet. `GET /api/internal/ledger/supply?days=30` serves both
to a scheduler, with every figure as a string so no consumer rounds it.

**Not built yet, on purpose:** sign-up does not create an account, there is no
starting grant, no transfers and no routes. Those are later prompts.

## Wallets

A wallet is not a table. It is a ledger account for the player plus one starting
grant, and `src/server/wallet` is the only code that sets it up.

**One account, one grant.** `ensureWallet(userId)` creates the account through the
ledger's idempotent `createPlayerAccount`, then posts the grant with the idempotency
key `onboarding-grant:<userId>`. The key is derived from the user, not from a clock,
so calling it a hundred times, twice at once, or from the backfill script pays
exactly once. Twenty concurrent calls are a test, not an assumption.

**The grant.** `onboarding_grant` is posted from `SYSTEM_MINT` to the player, which is
how money enters the game. The amount comes from
`src/server/config/economy-params.ts` (`startingBalanceKobo`, **PLACEHOLDER** ₦5,000
from `street-boys-docs/docs/14-economy-numbers.md`). No other file may hold an
economy number: change it there or not at all, and bump `version` so a grant can be
traced to the numbers in force when it posted.

**Heal on read.** `getWallet` calls `ensureWallet` first, so a player whose grant
failed at character creation gets one the next time they open a money screen. It
never throws into a page: a failure returns `{ setupPending: true }` and the page says
"we are setting up your wallet". A page that crashes because a balance is missing is
worse than a page that asks for a moment.

**Character creation never fails because of the wallet.** The character is written
first and is what the player asked for; a wallet failure is logged as
`wallet.setup_failed` and left to the next read. There is a test that hides
`SYSTEM_MINT` to prove it.

**The backfill.** `npm run wallets:backfill` walks every active user who has a
character and calls `ensureWallet` for each. Add `-- --dry-run` to see the count
without writing anything. It prints counts only, never ids or email addresses, and a
second run posts nothing.

**What a player can see.** Their own balance, and their own statement, newest first,
with the balance each entry left behind (a `SUM(amount_kobo) OVER (ORDER BY id)` in
SQL, then the page). There is no endpoint, page or component that takes an account id
from the caller, so there is no request shape that shows one player another's money.
Categories are translated for the page in `src/app/copy.ts`; an unknown category reads
as "Other" rather than leaking a ledger name.

**Ledger and wallet invariants.**

| Invariant                                          | How it is held                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| One account per player                             | unique `accounts.owner_user_id`, resolved insert in `createPlayerAccount` |
| Exactly one grant per user, even under concurrency | unique idempotency key `onboarding-grant:<userId>`                        |
| A wallet failure never blocks character creation   | the route catches, logs and returns 201                                   |
| Statements never expose another account            | the account comes from the session; no caller-supplied account id         |
| Amounts cross the wire as strings                  | `serializeAmount`; JSON has no bigint and a number would round            |
| Every line carries its balance                     | window function in SQL, not a sum over the page                           |

## Sign-in

Sign-in is email and a six-digit code, and nothing else: no password, no phone, no social provider.

1. `POST /api/auth/request-code` with `{ "email": "..." }`. The answer is always `{ "status": "sent" }` for an address we accept, whether or not an account exists, so this route cannot be used to find out who is registered.
2. The player receives "Your Street Boys code", which expires in 10 minutes.
3. `POST /api/auth/verify-code` with `{ "email": "...", "code": "123456" }`.
4. A new address gets `{ "status": "details_required" }` and the code is still usable: the same digits come back with `details: { "acceptTerms": true, "ageBand": "18_plus" }` and the account is created.
5. The session arrives as a cookie, `HttpOnly`, `SameSite=Lax`, `Secure` and `__Host-sb_session` in production, which lasts 30 days of use and never more than 90 days from sign-in. Five sessions per account: a sixth revokes the oldest.
6. `GET /api/me` returns the player, or 401. `POST /api/auth/logout` revokes the session and is safe to repeat. Every auth response carries `Cache-Control: no-store`.

A frozen or banned account is refused on every request, not just at sign-in, so a freeze takes effect on the next click.

### Email setup

The owner-facing half of the same feature. Two providers exist and the environment picks one: `console` prints the code to the server log and is refused in production, `brevo` sends it.

1. Create a Brevo account and an API key from **SMTP and API → API keys**. Put it in `BREVO_API_KEY`.
2. Add and **validate a sender** address under **Senders, Domains and IPs**. It goes in `EMAIL_FROM_ADDRESS`, with the name a player sees in `EMAIL_FROM_NAME`.
3. **Authenticate the sending domain** before launch: SPF, DKIM and DMARC. An unauthenticated domain lands in spam, and a code in spam is a player who cannot sign in. Brevo shows the DNS records to add.
4. Brevo's free plan allows **300 emails a day**. That is a beta limit, not a production one: at 300 sign-ins a day every further request fails and, by design, returns `send_failed` rather than a code that never arrives. Move to a paid plan before a launch push.

### Signing in locally

Leave `EMAIL_PROVIDER` unset (it defaults to `console`), set `APP_ORIGIN=http://localhost:3000`, then request a code and read it in the terminal:

```
curl -X POST http://localhost:3000/api/auth/request-code -H 'content-type: application/json' -H 'origin: http://localhost:3000' -d '{"email":"you@example.com"}'
```

The code appears as `[dev email] Your Street Boys code -> you@example.com: 123456`. The `origin` header is required: the guard refuses a request without one.

The same flow through the pages, which is what a player sees:

1. Open `http://localhost:3000`. The landing page says what the game is and sends you into sign-in.
2. Enter an email on `/login`. The terminal prints the code.
3. Type the six digits. A new address then asks for the terms checkbox and the age band, on the same page, and signs you up with the same code.
4. `/create-character` takes a name and three avatar options, and `/home` shows the character with `Balance: coming soon`.

Sign out from `/home`; it posts to `/api/auth/logout` and returns to the landing page.

### Pages and routes

| Page                   | Who sees it                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `/`                    | Everyone, indexable. `Play` goes to `/login`, or `/home` when signed in. |
| `/login`               | Signed out, or signed in without a character. `noindex`.                 |
| `/create-character`    | Signed in without a character. `noindex`.                                |
| `/home`                | Signed in with a character. `noindex`.                                   |
| `/terms`, `/privacy`   | Placeholders that say they are drafts. `noindex`.                        |
| `/account-unavailable` | A frozen or banned account, with no reason given. `noindex`.             |

| Route                         | What it does                                                         |
| ----------------------------- | -------------------------------------------------------------------- |
| `POST /api/auth/request-code` | Sends a code. Always `{ "status": "sent" }` for an accepted address. |
| `POST /api/auth/verify-code`  | Signs in, or returns `details_required`, or creates the account.     |
| `POST /api/auth/logout`       | Revokes the session. Safe to repeat.                                 |
| `GET /api/me`                 | The player, including their character, or 401.                       |
| `POST /api/character`         | Creates the one character an account may have. 201, then 409.        |

Access is gated in the page's own server component (`src/server/accounts/require-user.ts`), never in middleware: the app must run on any Node host, and an Edge runtime would tie it to one platform.

No player-facing string lives in a component. They are all in `src/app/copy.ts`, so a Pidgin or Yoruba pass is a translation of one file.

## First deploy checklist

Before the first deploy is called done:

1. **Env vars set** on the platform: `DATABASE_URL`, `OTP_PEPPER`, `IP_HASH_PEPPER`, `APP_ORIGIN`, `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`. Boot fails on a missing or short value, and it refuses `EMAIL_PROVIDER=console` in production, which is deliberate: a deploy that cannot send codes should not start.
2. **Migrations applied** as a pre-deploy step: `node dist/migrate.mjs`. Never at startup.
3. **A test sign-in** with a real address, on the deployed domain. The cookie must be `__Host-sb_session`, `Secure` and `HttpOnly`.
4. **A test email to Gmail, Outlook and Yahoo**, each checked for landing in spam rather than the inbox. Deliverability differs by provider and only a real send tells you.
5. **`APP_ORIGIN` matches the deployed domain**, or the origin guard refuses every sign-in with 403.
6. **A character created and a sign-out**, to prove the session, the character route and the gate all read the same database.

## Environment variables

Names only in the repository; values only in the platform's environment settings or in a gitignored `.env.local`. `.env.example` documents every name.

| Variable                                                                                    | Used now           | What it is                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                              | yes                | Postgres connection string (Neon pooled endpoint in production)                                               |
| `DATABASE_URL_TEST`                                                                         | yes, by tests only | A separate, disposable database for the integration tests                                                     |
| `DATABASE_URL_MIGRATE`                                                                      | migrations only    | A **direct** connection for `npm run db:migrate`. Falls back to `DATABASE_URL` when unset                     |
| `DATABASE_SSL`                                                                              | yes                | `require` or `disable`. Unset follows the URL's `sslmode`                                                     |
| `DB_POOL_MAX`                                                                               | yes                | Maximum pool connections. Default 5                                                                           |
| `TRUSTED_PROXY_HOPS`                                                                        | yes                | Proxy hops trusted when reading `x-forwarded-for`. Default 1                                                  |
| `CRON_SECRET`                                                                               | yes                | Bearer secret for `POST /api/internal/jobs/run`. Empty means the endpoint refuses everything                  |
| `IP_HASH_PEPPER`                                                                            | yes                | Pepper for account HMACs. 32+ characters. Changing it invalidates every stored hash                           |
| `EMAIL_PROVIDER`                                                                            | yes                | `brevo` or `console`. Required in production; `console` is refused there                                      |
| `EMAIL_FROM_ADDRESS`                                                                        | with brevo         | A validated sender address                                                                                    |
| `EMAIL_FROM_NAME`                                                                           | with brevo         | The sender name a player sees                                                                                 |
| `SESSION_SECRET`, `OTP_HASH_PEPPER`, `PAYSTACK_*`, `REALTIME_SERVICE_TOKEN`, `ADMIN_EMAILS` | **no**             | Declared ahead of the prompts that need them. Unused. Top-ups stay off until the lawyer review passes (D-129) |

No secret, key or connection string is ever committed. `.env*` is gitignored except `.env.example`.

### Choosing `DB_POOL_MAX`

The pool is created once per process and reused, which is correct in both worlds: a warm serverless instance keeps one pool, and a long-running server keeps one pool for its whole life. What changes between them is how many connections that pool is allowed to open, because a platform may run many instances of the app at once.

| Where                | Why                                                                                                                            | Suggested `DB_POOL_MAX`                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Vercel**           | Every function instance gets its own pool, and instances multiply under load. Connections are the scarce resource, not latency | **3–5**, against Neon's **pooled** connection string. Never the direct endpoint, or the database runs out of connections |
| **Railway / Render** | One long-running process (or a handful), stable connection count                                                               | **10–20**, or roughly `max_connections / instances` minus headroom for migrations and psql                               |

`DATABASE_URL` on Vercel must be the pooled endpoint (`...-pooler...`). The direct endpoint is for migrations, which run as a single pre-deploy step and do not need pooling.

## Deploying

The app must run on **Vercel, Railway and Render** with no platform-specific
dependency (D-139). Nothing in `src/` imports a host's SDK, and no route uses the
Edge runtime: every route runs on Node, because the database driver needs TCP.

Same three commands everywhere:

```bash
npm run build        # Next builds the standalone server
npm run build:migrate # bundles the migration to dist/migrate.mjs
node dist/migrate.mjs # pre-deploy only: applies pending SQL behind an advisory lock
npm start            # or: node server.js inside the image
```

**The pre-deploy command is `node dist/migrate.mjs` on Railway and Render.** It is
the bundled migration, so it runs in an image that installed production
dependencies only: no `dotenv`, no `tsx`, no `drizzle-kit`, no TypeScript. The
same file, before bundling, is what `npm run db:migrate` runs for a developer, so
there is one implementation and no second copy to drift. `docs/migrate-in-production.md`
records what the runtime image contains and why the old command failed.

**Migrations never run at app start.** They are a separate step before the new
code is promoted, guarded by `pg_advisory_lock`, so two deploys racing each other
cannot migrate twice.

| What      | Vercel                      | Railway                       | Render                       |
| --------- | --------------------------- | ----------------------------- | ---------------------------- |
| Runtime   | Serverless functions (Node) | Long-running container        | Long-running container       |
| Build     | `npm run build`, detected   | `railway.json` → `Dockerfile` | `render.yaml` → `Dockerfile` |
| Migrate   | separate CI step or runbook | `node dist/migrate.mjs`       | `node dist/migrate.mjs`      |
| Health    | `/api/health`               | `healthcheckPath`             | `healthCheckPath`            |
| Readiness | `/api/ready`                | `/api/ready`                  | `/api/ready`                 |
| Jobs      | Vercel Cron, optional       | cron service or Actions       | cron job in `render.yaml`    |
| Pool size | small (`DB_POOL_MAX=5`)     | larger (`10`)                 | larger (`10`)                |

### Vercel

1. **Import the repository.** Framework preset: Next.js. Nothing else is needed;
   `vercel.json` only pins the framework so a preview and production build behave
   the same.
2. **Set environment variables** in Project → Settings → Environment Variables:
   `DATABASE_URL` (Neon **pooled** connection string), `DB_POOL_MAX=5`,
   `TRUSTED_PROXY_HOPS=1`, `CRON_SECRET`. Never in the repo.
3. **Migrations** are not a Vercel build step that should be trusted on every
   preview deploy: run `npm run db:migrate` from CI against production before
   promoting, or as a documented manual step. A preview deployment must not
   migrate the production database.
4. **Health check:** point any uptime monitor at `/api/health` (liveness) and
   `/api/ready` (readiness, 503 when the database is unreachable).
5. **Pick the function region closest to the database**, from Project → Settings →
   Functions. A serverless function that crosses an ocean to reach Postgres pays
   for it on every query, and this app is a chatty one.
6. **Calling the jobs endpoint on a schedule:** Vercel Cron is one way, not the
   only way. A `crons` entry in `vercel.json` is deliberately not committed,
   because it would make Vercel the only scheduler this project knows.
   `POST /api/internal/jobs/run` with `Authorization: Bearer $CRON_SECRET` works
   from GitHub Actions on a schedule just as well.

### Railway

1. **New Project → Deploy from GitHub repo.** Railway reads `railway.json`: it
   builds the `Dockerfile` and starts `node server.js`.
2. **Variables:** `DATABASE_URL`, `DB_POOL_MAX=10`, `TRUSTED_PROXY_HOPS=1`,
   `CRON_SECRET`. Railway injects `PORT`; the image already listens on it.
3. **Pre-deploy:** `preDeployCommand` runs `node dist/migrate.mjs` in the same image
   before the new container takes traffic.
4. **Health check:** `/api/health`, as declared in `railway.json`.
5. **Jobs:** a Railway cron service, or GitHub Actions, calling the endpoint with
   the bearer secret.

### Render

1. **New → Blueprint**, point it at this repository. `render.yaml` creates the web
   service and a commented-out cron job.
2. **Fill the `sync: false` variables** in the dashboard: `DATABASE_URL`,
   `CRON_SECRET`, and `APP_ORIGIN` for the cron job. Values are never in the file.
3. **Pre-deploy:** `preDeployCommand: node dist/migrate.mjs`, inside the image,
   behind the advisory lock.
4. **Health check:** `/api/health`, as declared.
5. **Jobs:** enable the `street-boys-jobs` cron service in `render.yaml`, which
   POSTs to the endpoint hourly with the bearer secret.

### Environment variables per platform

Names and formats only; the same names are listed earlier in [Environment variables](#environment-variables), and this table adds where each one is set. Every value is set in the host's dashboard or a
gitignored `.env.local`.

| Name                 | Required       | Used on                 | Format                                 |
| -------------------- | -------------- | ----------------------- | -------------------------------------- |
| `DATABASE_URL`       | yes            | all three               | `postgresql://USER:PASSWORD@HOST/DB`   |
| `DATABASE_URL_TEST`  | tests only     | CI, local               | same shape, a disposable database      |
| `DATABASE_SSL`       | no             | all three               | `require` or `disable`                 |
| `DB_POOL_MAX`        | no (default 5) | all three               | integer, `5` on Vercel, `10` elsewhere |
| `TRUSTED_PROXY_HOPS` | no (default 1) | all three               | integer, `0`–`10`                      |
| `CRON_SECRET`        | for jobs       | all three               | 16+ random characters, unset disables  |
| `PORT`               | no             | Railway, Render, Docker | injected by the host                   |
| `APP_ORIGIN`         | for cron jobs  | Render                  | `https://your-service.onrender.com`    |

**Neon is a working assumption, not a decision.** Any Postgres works; the driver
is plain `pg`, and the connection string is the only thing that changes.

## Secrets

**No credential ever enters this repository.** Not in code, not in a config file, not in `package.json`, not in a URL, not in a doc, not in a commit message, not in a prompt to an agent.

| Rule                           | Detail                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Environment variables only** | `DATABASE_URL`, `CRON_SECRET`, `OTP_PEPPER`, `BREVO_API_KEY` and friends are read from the environment. `.env.example` lists the **names** with empty or obviously fake values                                |
| **Never in a URL**             | A URL like `https://user:token@github.com/...` writes the credential into `package.json`, `.git/config`, a lockfile, a log line and every clone. Use the plain URL and let the platform supply the credential |
| **Never printed**              | No agent, script or person prints, echoes, pastes or logs a secret value. Refer to it by **file path and line number** only. A value pasted into a chat, an issue or a screenshot is a leaked value           |
| **If you find one: stop**      | Do not paste it, do not commit around it, do not rewrite history. Tell the owner, say where it is by path and line, and let them rotate it                                                                    |
| **Rotation is the fix**        | Removing a secret from the working tree does not remove it from history. **Rotating the credential is what actually ends the exposure**; history cleanup is a separate, deliberate decision                   |
| **Scanning**                   | `gitleaks` runs in CI on every push and pull request. The job is in `CI.md`, ready to paste into the workflow                                                                                                 |

Local `.env*` files are gitignored (`.env.example` is the one exception). Secrets live in the platform's environment settings, never in this repository.

## Branch and pull request rules

- **Never push to `main`.** Every change reaches `main` through a pull request.
- Branch names: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`. This work is `feat/project-setup`.
- One feature per branch, one pull request per feature. Commit messages: `type: summary`.
- CI (lint, typecheck, unit tests, database tests, build) must pass. **Never skip, weaken or delete a test to make it pass.** The workflow lives in [`CI.md`](./CI.md) and still needs installing as `.github/workflows/ci.yml`: the agent's GitHub connection lacks the `workflow` scope, so it could not be committed.
- Every pull request follows `.github/PULL_REQUEST_TEMPLATE.md` and declares its review level: **L1** presentation, **L2** game logic, **L3** money and trust. **An agent never merges an L3 pull request**; it opens it, labels it `needs-owner-review`, and stops.

The full rules for agents are in [`AGENTS.md`](./AGENTS.md), with per-repository versions in the docs repo's `templates/` folder.

## Performance budget

The audience is a cheap Android phone on a slow Nigerian connection, so weight is a feature decision, not a detail:

| Budget                    | Target                                       |
| ------------------------- | -------------------------------------------- |
| **First-load JavaScript** | **under 200 KB gzipped**                     |
| Images on first load      | none                                         |
| Third-party scripts       | none                                         |
| Fonts                     | system fonts only (no webfont download)      |
| Above-the-fold layout     | no shift, no heavy asset before it is needed |

**Measured today** (production build, gzipped, every script the page loads):

| Page                                              | First-load JavaScript |
| ------------------------------------------------- | --------------------- |
| `/login`                                          | **182 KB**            |
| `/create-character`                               | **179 KB**            |
| `/home`                                           | **178 KB**            |
| `/wallet`                                         | **178 KB**            |
| `/`, `/terms`, `/privacy`, `/account-unavailable` | **176 KB**            |

The floor is the problem, not the pages: an empty App Router page with no client code of its own already loads **175.9 KB**, of which three chunks account for 153 KB (React DOM, the React client runtime and the Next.js runtime). The pages in this feature add 10 to 15 KB each on top of that, and the 175 KB ceiling in the prompt cannot be met by this stack as configured.

That is a decision for the owner, not something to hide in a table. Either the ceiling moves to about 200 KB for the signed-in pages, or the framework question (fewer client components, a lighter router) is opened properly. It is listed in the pull request as an open question.
It is written down here rather than discovered at launch.

If a dependency or an asset cannot fit the budget, say so in the pull request instead of shipping it quietly.

## Where things live

| Path                 | What it is                                                    |
| -------------------- | ------------------------------------------------------------- |
| `src/app`            | Pages and routes (App Router)                                 |
| `src/app/api`        | HTTP routes: health, ready, auth, me, character               |
| `src/app/copy.ts`    | Every string a player reads, in one file                      |
| `src/shared`         | Static non-secret data the client may import (avatar ids)     |
| `src/server/db`      | Drizzle client, schema, migrations                            |
| `src/server/ledger`  | Reserved: the only place that may ever change a balance       |
| `src/server/pricing` | Reserved: the shared `base × COLI` pricing function           |
| `src/server/config`  | Reserved: versioned economy parameters and their typed loader |
| `src/test`           | The database test harness                                     |
| `drizzle/`           | The SQL migrations themselves                                 |
| `docs-ref/`          | Read-only snapshots of the design docs                        |
| `CI.md`              | The CI workflow, and the one step needed to switch it on      |

## Design documentation

The design docs — the decisions log, the economy numbers, the ledger design — live in [`street-boys-docs`](https://github.com/wisdom-technologies-bit/street-boys-docs). `docs-ref/` holds snapshots for convenience; the docs repository is the source of truth.
