# src/server/config

**Purpose:** The versioned economy parameters and the typed loader that reads them.
**Status:** Empty. The loader arrives with the prompt that first needs a number (D-128, D-136).

Nothing is implemented here yet.

## What will live here

A typed loader over versioned economy parameters, validated with Zod, with a clear failure when a value is missing or the wrong shape. Later, the admin screen that changes a parameter and the log that records the change.

## Rules from AGENTS.md (section 6)

- **Never hard-code an economy number.** Not a price, a wage, a fee, a tax rate, a limit, a timer or a probability.
- **All numbers come from `docs/14-economy-numbers.md`**, through this loader. No `process.env` reads scattered through modules, no magic numbers in components.
- **The admin can change a parameter without a redeploy**, and **every change is logged**: who, when, the old value, the new value and the reason.
- **Changing a parameter is Level 3.** It changes the economy for every player at once.
- **A missing number is a question, not a decision.** Stop and ask the owner.
- Config is versioned: a change to the parameters is a new version, so a past day can always be explained with the numbers that were live at the time.
- **This folder does not compute prices.** It supplies base values; `src/server/pricing` multiplies them by COLI.
