# src/app/api

**Purpose:** HTTP routes. The only way a client reaches the server.
**Status:** Working. `/api/health`, `/api/ready` and the protected `/api/internal/jobs/run`.

## What is here

`GET /api/health` is **liveness**: always 200, `{ status: "ok", version }`, and it never touches the database (D-142). `GET /api/ready` is **readiness**: it runs a trivial query and returns 200 `{ status: "ready" }` or 503 `{ status: "not_ready" }`, with no connection detail in either body. Both are `no-store`, because a cached health check is a lie.

## Rules from AGENTS.md (sections 4, 6 and 7)

- **Authenticate and authorize every route.** Default deny. A public route is named and justified; `/api/health` is public because a probe has no user.
- **Validate every input with Zod** before it is used: body, query, params, headers you rely on.
- **The server decides, the client asks.** Clients send intentions, never amounts or results. If a request body carries a price or a total that the server then uses, that is a bug.
- **Never send hidden data.** NPC limits, patience, corruption, police presence and any roll the player should not see stay server side.
- **Rate-limit sensitive routes** (login, OTP, transfers, haggle actions, anything a script would farm).
- **Money moves only through `src/server/ledger`**, and only with an idempotency key.
- **No personal data in logs** and no secrets in responses. An error message is a gift to an attacker.
- **Webhooks verify their signature** and are idempotent (Paystack retries).
