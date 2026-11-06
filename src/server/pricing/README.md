# src/server/pricing

**Purpose:** The one shared pricing function: every NPC price, wage and fee is `base value × COLI`.
**Status:** Empty. Pricing arrives with the prompts that first need it (D-132, D-137).

Nothing is implemented here yet. The folder exists now so that no future module invents its own way to work out a price.

## What will live here

One function that takes a base value from the economy config and returns today's price, plus the helpers the game needs around it (player guardrails, which are percentages of the NPC baseline).

## Rules from AGENTS.md (section 6) and docs/14 §0.5

- **Final prices are computed, never stored.** The database holds base values and the index; the price exists only at the moment of use.
- **One function, used by everything.** Jobs, shops, meals, rent, transport, licences, fines and system-sold property all call it. Two ways of pricing means two economies.
- **No hard-coded numbers.** Base values come from the versioned config loader in `src/server/config`. A number that is not in `docs/14-economy-numbers.md` is a question for the owner, not a decision for the agent.
- **COLI scales NPC prices, NPC wages, fixed fees and system-sold property.** Percentage charges (property tax, transfer tax) follow automatically. **Player-set prices are not scaled**; their floors and ceilings are percentages of the moving baseline.
- **One global index, recomputed once per in-game month** from money per active player, capped at +4% and −1% a month (PLACEHOLDER). An active player is one who completed at least one shift in the last 7 days.
- **Admin overrides and freezes are logged** with who, when, old value, new value and reason.
