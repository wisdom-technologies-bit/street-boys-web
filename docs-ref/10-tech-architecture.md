# 10 — Tech Architecture

**Purpose:** Define the repositories, stack, authority model and the non-negotiable ledger rules that the build must follow.
**Status:** Decided (implementation detail beyond these decisions is open)

## Four private repositories

| Repository | Holds | Deploys to |
|---|---|---|
| **`street-boys-docs`** | This design documentation | — (Markdown only) |
| **`street-boys-web`** | Next.js front end, API routes, scheduled jobs | **Vercel** |
| **`street-boys-realtime`** | Colyseus game server | **Railway or Fly.io** |
| **`street-boys-assets`** | Tilemaps, sprites, UI, audio | Later |

### Hard separations

- **`street-boys-realtime` holds no money logic.** The realtime server handles presence, movement, rooms and scenes. It does not touch balances.
- **`street-boys-assets` is later.** It is not a launch dependency.
- **`street-boys-docs` contains no application code.** This repo stays documentation only.

## Data

- **Postgres** (Neon or Supabase; Neon is the working assumption, see [13-parked-and-open-questions.md](13-parked-and-open-questions.md) O-96).
- **Drizzle**, with **SQL migrations only** (D-124). No ad-hoc schema changes, no second ORM, no direct production edits, no `drizzle-kit push` against a shared database.
- **Money is stored as integer kobo** in `bigint` columns, never a float (D-123).
- **No Base44 database.** Base44's database and SDK are not part of this product.

## Rendering

- **Phaser** for the world map.
- Presentation model is defined in [02-world-and-city.md](02-world-and-city.md): top-down shared map with tap-to-move, plus close-up job scenes.

## Server authority

**The server is authoritative for all money, pay, haggle and arrest outcomes. Clients send intentions only.**

| System | Who decides |
|---|---|
| Money movement | Server (ledger module only) |
| Pay and contract settlement | Server |
| Haggling outcomes and NPC limits | Server; NPC limits never sent to the client |
| Arrest and jail | Server |
| Movement and presence | Realtime server |

This is both an anti-cheat rule and a design rule: the client is a view, not a referee.

## The ledger module

**The ledger module is the only code allowed to change balances.**

It must have automated tests covering at least:

| Test | What it proves |
|---|---|
| **Total money balances** | Sum of all entries is consistent; money is neither created nor destroyed outside System |
| **No double payment** | A replayed action does not pay twice |
| **No negative balance** | A player cannot spend money they do not have |
| **Idempotent retries** | Retrying a request with the same idempotency key is safe |

Ledger design: [03-economy-and-ledger.md](03-economy-and-ledger.md).

If any other module needs to move money, it calls the ledger. It does not update a balance column.

## Secrets

**Secrets live in platform environment settings, never in repos.**

- No keys, tokens, webhook secrets or database URLs committed to any of the four repositories.
- Payments, database and deployment credentials are set in Vercel, Railway/Fly.io and the database provider.

## Branches and deploys

| Branch | Purpose |
|---|---|
| **`main`** | Live |
| **`staging`** | Pre-production |
| **preview deploy per pull request** | One preview environment per PR |

Every change reaches live by passing through a pull request and staging. Nobody pushes straight to `main` for anything that touches money.

## Who writes the code

**The Base44 Agent writes code inside the repos only.** Not in a chat window, not in a scratchpad that nobody reviews: in the repositories, through branches and pull requests, so the work is reviewable and traceable.

## What is not decided

- The choice between Neon and Supabase (Neon is the working assumption in [AGENTS.md](../AGENTS.md)).
- The choice between Railway and Fly.io.
- Colyseus room configuration and tick rate.
- Hosting region.
- Monitoring, alerting and error tracking.
- Backups and restore drills.
- Whether payments use Paystack or Flutterwave (see [09-monetization-and-legal.md](09-monetization-and-legal.md)).

These are listed in [13-parked-and-open-questions.md](13-parked-and-open-questions.md).

## How the code is written

The stack above is the summary. The rules an agent follows when writing it — integer kobo, the one ledger module, server authority, config instead of hard-coded numbers, security, review levels, branches and definition of done — are in [AGENTS.md](../AGENTS.md), with per-repository versions in [templates/](../templates/). The order the work is done in is [prompts/](../prompts/README.md), and how the owner runs and reviews a task is [16-agent-workflow.md](16-agent-workflow.md).

## Related docs

- The build rules: [AGENTS.md](../AGENTS.md)
- How to run a task: [16-agent-workflow.md](16-agent-workflow.md)
- The order of work: [prompts/README.md](../prompts/README.md)
- Ledger rules: [03-economy-and-ledger.md](03-economy-and-ledger.md)
- Rooms and instances: [02-world-and-city.md](02-world-and-city.md)
- Payment integration and the legal gate: [09-monetization-and-legal.md](09-monetization-and-legal.md)
- What actually gets built first: [11-mvp-scope.md](11-mvp-scope.md)
