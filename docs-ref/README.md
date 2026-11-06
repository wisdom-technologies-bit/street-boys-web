# docs-ref

**Purpose:** Read-only snapshots of the design documents an agent needs while working in this repository.
**Status:** Snapshot of `street-boys-docs` at commit `3da283b`.

## What is here

| File | Why it is here |
|---|---|
| `03-economy-and-ledger.md` | The money model: double entry, the System and Treasury accounts, why the ledger is append-only |
| `10-tech-architecture.md` | Repositories, stack, server authority, and the rules on secrets, branches and deploys |
| `12-decisions-log.md` | Every numbered decision (`D-###`). **This is the authority** |
| `14-economy-numbers.md` | Every price, wage, fee, limit and target band, plus COLI and the implementation notes for this repo |

## Rules

- **These are copies, not the source.** `street-boys-docs` wins. If a copy here is stale, the docs repository is right.
- **If `AGENTS.md` and anything in here disagree, stop and ask** rather than choosing. A conflict means one of them is out of date, and guessing which one is how a decision gets silently reversed.
- **Do not edit these files here.** A change to the design is made in `street-boys-docs` and re-copied, so the history stays in one place.
- **A decision that conflicts with a task means the task stops.** Never implement around a logged decision.
