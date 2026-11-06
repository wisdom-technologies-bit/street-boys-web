# src/server/ledger

**Purpose:** The only code in this repository allowed to create ledger entries or change a balance.
**Status:** Empty. The ledger arrives with prompt `web-03` (Level 3).

Nothing is implemented here yet. This README exists so that the module boundary is decided before the first line of money code is written, because that boundary is the one rule the project cannot recover from getting wrong.

## What will live here

The public functions other modules call to move money: posting a job payment, a transfer, a fee, a system-sold property purchase. Other modules import these functions. They never touch a balance column.

## Rules from AGENTS.md (sections 4 and 9)

- **Money is integer kobo** in `bigint` columns. Never a float, never a decimal string, never naira. ₦1 is `100`.
- **Double entry, append only.** Every movement posts balanced entries and the whole ledger sums to zero at all times. Corrections are new compensating entries, never edits.
- **The database enforces append-only.** Rules or triggers must reject `UPDATE` and `DELETE` on ledger tables. Code alone is not enough.
- **Every money action carries a unique idempotency key**, and the key describes the action (`job:pay:<session-id>`), not the attempt.
- **Reads then writes inside a serializable transaction or behind a row lock.** A balance can never go negative, and the database refuses it too.
- **`System` is the only account where money is created or destroyed.** `Treasury` holds government money.
- **No prices or amounts computed here.** Amounts are decided by the caller from the config loader; the ledger moves them.

## The four tests every change here needs

1. The ledger sums to zero after the operation.
2. An idempotent retry pays once, not twice.
3. Two concurrent spends cannot overdraw.
4. A negative balance is rejected by the system, not by luck.

These reuse the database harness in `src/test/`. Any pull request touching this folder is **Level 3**: labelled `needs-owner-review` and merged by the owner, never by an agent.
