# AGENTS.md — `street-boys-web`

**Purpose:** The rules an AI coding agent follows inside `street-boys-web`, the Next.js application that holds the game's screens, API routes, scheduled jobs and the money.
**Status:** Decided (D-123 to D-130). Copy this file to the root of `street-boys-web` as `AGENTS.md`.

This is a specialisation of the parent rules in `street-boys-docs/AGENTS.md`. The parent file still applies in full. This file adds the detail that only matters inside this repository.

---

## 1. What this repository is

`street-boys-web` is the whole application: the Next.js front end, the API routes, the scheduled jobs, the database access **and the ledger**. It deploys to Vercel.

It is the only repository allowed to touch money, and inside it only one module is allowed to: `src/server/ledger`.

## 2. Source of truth

`street-boys-docs` wins. Before writing code:

1. Read `docs/12-decisions-log.md` for the decision you are implementing.
2. Read the numbered design doc for the feature.
3. Read `docs/14-economy-numbers.md` for every number you need.

If the task conflicts with a decision, or needs a number that is not in docs/14, **stop and ask**. Do not fill the gap.

## 3. The stack, exactly

| Concern    | Choice                         | Notes                                                                               |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Framework  | Next.js, **App Router**        | No Pages Router. Server Components by default                                       |
| Language   | TypeScript, **`strict: true`** | `any` is not a solution. `unknown` plus Zod is                                      |
| Database   | Postgres on **Neon**           | One database. No second store                                                       |
| ORM        | **Drizzle**                    | SQL migrations only. No `drizzle-kit push` against a shared database, no second ORM |
| Validation | **Zod**                        | Every external input: body, query, params, webhooks                                 |
| Tests      | **Vitest**                     | Unit and integration, in that order of preference                                   |
| Lint       | **ESLint**                     | Configured once, obeyed                                                             |
| CI         | **GitHub Actions**             | lint → typecheck → test on every PR                                                 |
| Hosting    | **Vercel**                     | Preview deployment per PR                                                           |

### Prohibited here

- **No Base44 SDK, no Base44 database, no Base44 API.**
- **No other databases.** No Redis, no SQLite, no JSON files as a store, unless a logged decision adds one.
- **No new dependency without a stated reason** in the PR: what it does, why an existing tool cannot, and its cost in bundle size. This app runs on cheap Android phones; every kilobyte is paid for.

## 4. Money rules

### 4.1 Storage

- **Integer kobo, always.** Postgres `bigint`. TypeScript `bigint` or a plain integer. **Never a float, never a decimal string, never naira in the database.**
- ₦1 = 100 kobo. ₦15,000 = `1500000`.
- Division by 100 happens in **one formatter**, used only for display.

### 4.2 The ledger module is the only place money changes

```
src/server/ledger/
  index.ts        the public functions other modules may call
  accounts.ts     System, Treasury and player account resolution
  transfer.ts     double-entry posting
  errors.ts       typed failures (insufficient funds, duplicate key, ...)
```

- The ledger is the **only** code that inserts ledger entries or updates a balance.
- Other modules call it: `postJobPay(...)`, `postTransfer(...)`, `postFee(...)`. They never write a balance, never compute a stored total, never "just this once" touch the table.
- If a feature needs a movement the ledger cannot express, the agent adds a ledger function **with the four required tests**. It does not work around the ledger.

### 4.3 Double entry and append-only, enforced by the database

- Every movement posts balanced entries. The sum across the whole ledger is zero.
- Ledger tables are **append-only**: a database rule or trigger **rejects `UPDATE` and `DELETE`**. Code alone is not enough.
- Corrections are compensating entries, with a reason, never an edit.

### 4.4 Idempotency

- Every money action carries a unique **idempotency key**, unique in the database.
- The key describes the action, not the attempt: `job:pay:<session-id>`, `transfer:<client-request-id>`, `topup:<provider-reference>`.
- A replayed key must be a no-op that returns the original result, not a second payment.

### 4.5 Concurrency

- Read-then-write on a balance happens inside a **serializable transaction** or behind a **row lock**.
- **A balance can never go negative**, and the database refuses it, not only the application.
- Two spends racing: one succeeds, one fails cleanly with a typed error the UI can show.

### 4.6 The two system accounts

- **System**: the only account where money is created or destroyed.
- **Treasury**: holds government money — remittances, licences, fines, fees, and spends on projects.

### 4.7 The four tests

Every PR that touches the ledger includes all four, passing:

1. **Balances to zero** — the ledger sums to zero after the operation.
2. **Idempotent retry pays once** — replaying the key does not double-pay.
3. **Concurrent spends cannot overdraw** — a race produces exactly one success.
4. **Negative balance rejected** — the system refuses to go below zero.

## 5. Server authority

| Feature                       | Server computes                                                         | Client sends      |
| ----------------------------- | ----------------------------------------------------------------------- | ----------------- |
| Job pay                       | The amount, after energy, diminishing returns, skill and any multiplier | "work this shift" |
| Haggle                        | NPC limits, patience, whether the offer is accepted                     | the offer         |
| Arrest, fine, jail            | Everything                                                              | nothing           |
| Corruption, leakage, projects | Everything                                                              | nothing           |
| Price checks                  | The price from config                                                   | the item          |

- **Never trust an amount from the client.** If a request body contains a `price`, `amount` or `total` that the server then uses, that is a bug — even if the server "checks" it.
- **Never send hidden data to the client.** NPC hidden limits, patience meters, corruption level, police presence, hidden stock, and any roll the player should not see stay server-side. Not in a JSON payload, not in a `data-` attribute, not in a debug field.
- Route Handlers and Server Actions are the boundary. Anything in a Client Component is untrusted, because it is.

## 6. Economy parameters

- **No hard-coded economy numbers, anywhere.** No prices, wages, fees, tax rates, limits, timers or probabilities in components, routes or services.
- All numbers come from `docs/14-economy-numbers.md` and live in a **versioned config table (or versioned config file)** read through a **typed loader** in `src/server/config`. The loader validates with Zod and returns a typed object.
- The admin can change a parameter **without a redeploy**, and every change is **logged**: who, when, old value, new value, reason.
- **Changing a parameter is Level 3.** It changes the economy for every player at once.
- A number that is not in docs/14 is **not** a decision for the agent. Stop and ask.
- **NPC prices, wages and fees are computed as base value x COLI through the shared pricing function; never store or hard-code final prices.** The shared pricing function is the only place a base value meets the index.

## 7. Security

- **Authenticate and authorize every route.** Default deny. Public routes are named explicitly and justified.
- **Validate every input with Zod** before it is used, including route params and webhook bodies.
- **Rate-limit** login and OTP, transfers, haggle actions, marketplace listings and anything a script would farm. Fail closed.
- **Verify Paystack webhook signatures** before parsing the body. **Make webhook handling idempotent** — Paystack retries, and the retry must not credit twice.
- **Parameterized queries only.** Drizzle's builder or tagged SQL. No string concatenation.
- **No secrets in the repo.** Environment variables only; `.env.example` holds placeholder names. **Never in a URL, never printed, never pasted. See section 13, which is non-negotiable.**
- **No personal data in logs.** No phone numbers, names, OTPs, tokens or full request bodies.
- **Audit log** every money action, admin action and moderation action.
- **NDPA:** collect the minimum personal data the game needs, hold it only as long as needed.

## 8. Scheduled jobs

- Every scheduled job is **idempotent**: running twice must not pay twice or charge twice.
- A job that moves money takes a lock or uses a unique job-run key.
- A job that fails must fail loudly and leave a record, not half-apply.

## 9. Review levels for this repository

| Level  | Examples here                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | Screen layout, styling, copy, a display-only component                                                                                                        |
| **L2** | Jobs engine, haggle engine, property, groups, police, clock, profile                                                                                          |
| **L3** | **`src/server/ledger/**`, transfers, auth and OTP, payments and webhooks, migrations, admin tools, the config loader and any change to an economy parameter** |

Unsure between L2 and L3? It is L3. An L3 pull request is opened, labelled `needs-owner-review`, explained, and **left open**. The agent does not merge it.

## 10. Workflow

- Branch: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`. **Never push to `main`.**
- One feature per branch, one pull request per feature.
- Commits: `type: summary` — `feat: add job pay posting`, `fix: reject negative balance`.
- Database changes **only** through a Drizzle migration, committed with the code, reviewed as Level 3.
- CI must be green. **Never weaken, skip or delete a test to pass.** If a test is wrong, fix it in its own commit and say why.
- Every PR uses the pull request template from `street-boys-docs/templates/PULL_REQUEST_TEMPLATE.md` and names the prompt number it came from.

## 11. Definition of done

- [ ] Works on the **preview deployment**, clicked through.
- [ ] Tests added or updated and passing.
- [ ] `street-boys-docs` updated if behaviour changed.
- [ ] New decision logged, new gap added to docs/13.
- [ ] Works on a cheap Android phone on a slow connection: small bundle, no heavy asset on first load, no dependency the device cannot afford.
- [ ] Review level declared; L3 left open for the owner.

## 12. Stop and ask

Stop when: the task conflicts with a `D-###` decision; a number is missing from docs/14; the task depends on a question in docs/13; the work turns out to need an L3 change the task did not mention; two docs disagree; or you would have to invent something to continue.

One clear question beats an invented answer.

## 13. Secrets (non-negotiable)

A credential is a key to the owner's accounts. One pasted token in a public place can cost money, data or the whole repository.

| Rule                                                | Detail                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Never in a URL**                                  | `https://user:token@host/...` writes the secret into `package.json`, `.git/config`, lockfiles, logs and every clone. This repository has already been bitten by exactly this. Use the plain URL |
| **Never in code, docs, prompts or commit messages** | Not in a string, a comment, a fixture, a README example, a PR description, a task you hand an agent, or a commit message                                                                        |
| **Environment variables only**                      | Names in `.env.example` (empty or obviously fake), values in the platform's environment settings                                                                                                |
| **An agent never prints a secret**                  | No `echo`, no `cat`, no debugging output, no exception message. Refer to it as **file path and line number**                                                                                    |
| **If you find one: stop**                           | Say where it is by path and line, never the value. Do not commit, do not push, do not rewrite history. The owner rotates it                                                                     |
| **Removing it is not enough**                       | A removed secret is still in history and still valid until it is rotated. **Rotation is the fix**; history rewriting is a separate decision the owner makes deliberately                        |
| **Scan before you push**                            | `gitleaks` runs in CI. If CI reports a finding, the push is not done                                                                                                                            |

## 14. Working in small steps

The work is larger than one session, and a session can end without warning. Plan for that.

- **Commit and push after every milestone.** A milestone is something that works and would survive a revert, not a half-finished edit.
- **Keep each task small.** One feature, one branch, one pull request. If a task is growing past what one session can finish, cut it and say so.
- **Running low on tools or time? Stop at a clean commit.** Then list the remaining work in the pull request description. Never leave uncommitted changes behind and never leave the branch in a state that does not build.
- **Never leave a half-applied migration.** A schema that is migrated but not deployed, or deployed but not migrated, is worse than no deploy.
- **Say what is done and what is not.** "Configured but not verified" is an honest status; "working" is a claim that needs evidence.
