# src/app/api

**Purpose:** HTTP routes. The only way a client reaches the server.
**Status:** Working. `/api/health` is the first and only route.

## What is here

`GET /api/health` returns `{ status: "ok", db: "ok" | "down", version }`. It runs a trivial query, reports the database as up or down, and returns no host, driver, error message or stack. It is `no-store`, because a cached health check is a lie.

## Rules from AGENTS.md (sections 4, 6 and 7)

- **Authenticate and authorize every route.** Default deny. A public route is named and justified; `/api/health` is public because a probe has no user.
- **Validate every input with Zod** before it is used: body, query, params, headers you rely on.
- **The server decides, the client asks.** Clients send intentions, never amounts or results. If a request body carries a price or a total that the server then uses, that is a bug.
- **Never send hidden data.** NPC limits, patience, corruption, police presence and any roll the player should not see stay server side.
- **Rate-limit sensitive routes** (login, OTP, transfers, haggle actions, anything a script would farm).
- **Money moves only through `src/server/ledger`**, and only with an idempotency key.
- **No personal data in logs** and no secrets in responses. An error message is a gift to an attacker.
- **Webhooks verify their signature** and are idempotent (Paystack retries).
