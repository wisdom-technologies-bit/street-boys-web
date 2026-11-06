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

## Environment variables

Names only in the repository; values only in the platform's environment settings or in a gitignored `.env.local`. `.env.example` documents every name.

| Variable                                                                                    | Used now           | What it is                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                              | yes                | Postgres connection string (Neon pooled endpoint in production)                                               |
| `DATABASE_URL_TEST`                                                                         | yes, by tests only | A separate, disposable database for the integration tests                                                     |
| `DATABASE_SSL`                                                                              | yes                | `require` or `disable`. Unset follows the URL's `sslmode`                                                     |
| `DB_POOL_MAX`                                                                               | yes                | Maximum pool connections. Default 5                                                                            |
| `TRUSTED_PROXY_HOPS`                                                                        | yes                | Proxy hops trusted when reading `x-forwarded-for`. Default 1                                                  |
| `CRON_SECRET`                                                                               | yes                | Bearer secret for `POST /api/internal/jobs/run`. Empty means the endpoint refuses everything                  |
| `SESSION_SECRET`, `OTP_HASH_PEPPER`, `PAYSTACK_*`, `REALTIME_SERVICE_TOKEN`, `ADMIN_EMAILS` | **no**             | Declared ahead of the prompts that need them. Unused. Top-ups stay off until the lawyer review passes (D-129) |

No secret, key or connection string is ever committed. `.env*` is gitignored except `.env.example`.

### Choosing `DB_POOL_MAX`

The pool is created once per process and reused, which is correct in both worlds: a warm serverless instance keeps one pool, and a long-running server keeps one pool for its whole life. What changes between them is how many connections that pool is allowed to open, because a platform may run many instances of the app at once.

| Where | Why | Suggested `DB_POOL_MAX` |
|---|---|---|
| **Vercel** | Every function instance gets its own pool, and instances multiply under load. Connections are the scarce resource, not latency | **3–5**, against Neon's **pooled** connection string. Never the direct endpoint, or the database runs out of connections |
| **Railway / Render** | One long-running process (or a handful), stable connection count | **10–20**, or roughly `max_connections / instances` minus headroom for migrations and psql |

`DATABASE_URL` on Vercel must be the pooled endpoint (`...-pooler...`). The direct endpoint is for migrations, which run as a single pre-deploy step and do not need pooling.

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
| **First-load JavaScript** | **under 150 KB gzipped**                     |
| Images on first load      | none                                         |
| Third-party scripts       | none                                         |
| Fonts                     | system fonts only (no webfont download)      |
| Above-the-fold layout     | no shift, no heavy asset before it is needed |

**Measured today** (production build, gzipped, every script on `/`): **170 KB**. The empty application already sits about **20 KB over the 150 KB target**, before a single game screen exists, because the Next.js 16 and React 19 runtime is the floor. That gap is a real problem to solve in a later prompt (fewer client components, check what Next ships by default, or accept a higher ceiling). It is written down here rather than discovered at launch.

If a dependency or an asset cannot fit the budget, say so in the pull request instead of shipping it quietly.

## Where things live

| Path                 | What it is                                                    |
| -------------------- | ------------------------------------------------------------- |
| `src/app`            | Pages and routes (App Router)                                 |
| `src/app/api`        | HTTP routes, starting with `/api/health`                      |
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
