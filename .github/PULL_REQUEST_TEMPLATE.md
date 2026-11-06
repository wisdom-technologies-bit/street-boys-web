# Pull request

**Purpose:** The template every pull request uses in every Street Boys repository, so that a reviewer can tell in ten seconds what changed, how risky it is, and whether it is allowed to merge.
**Status:** Decided (D-123 to D-130). Copy to `.github/PULL_REQUEST_TEMPLATE.md` in each repository.

---

## Summary

<!-- What does this change do, in two or three sentences, in plain English?
     Lead with the player-visible result, not the file list. -->

## Prompt

|                   |                                                        |
| ----------------- | ------------------------------------------------------ |
| **Prompt number** | <!-- e.g. web-03, from prompts/README.md -->           |
| **Repository**    | <!-- street-boys-web / -realtime / -assets / -docs --> |
| **Branch**        | <!-- feat/..., fix/..., docs/... -->                   |

## Review level

<!-- Tick exactly one. If unsure, tick L3 and explain why below. -->

- [ ] **L1 — UI only.** Presentation, no game logic, no money.
- [ ] **L2 — Game logic.** Behaviour, but no money movement.
- [ ] **L3 — Money and trust.** Ledger, transfers, auth, payments, migrations, admin tools, economy parameters.

> An **L3** pull request carries the label **`needs-owner-review`** and **is not merged by the agent**. It is opened, explained, and left for the owner.

**Why this level:** <!-- one line. If you chose L3, say which of the L3 triggers applies. -->

## Tests added

<!-- List the tests you added or changed. "None" is only acceptable for L1 with a screenshot.
     If this touches the ledger, all four ledger tests must appear here. -->

| Test | What it proves |
| ---- | -------------- |
|      |                |

**Ledger checks** (only if money moves in this PR):

- [ ] The ledger sums to zero after the operation
- [ ] An idempotent retry pays once, not twice
- [ ] Two concurrent spends cannot overdraw
- [ ] A negative balance is rejected by the system

## Migrations

- [ ] **No** — no database change
- [ ] **Yes** — migration file(s) included: <!-- path -->

If yes: is it forward-only, and does it run on a preview database before merge? <!-- one line -->

## Money paths touched

- [ ] **No** — nothing in this PR changes a balance, a price, a fee or a payment
- [ ] **Yes** — describe the exact money path below

**Money path:** <!-- e.g. "player shift ends → payJobShift() posts System → player, idempotency key job:pay:<session-id>" -->

## Economy parameters

- [ ] This PR reads all its numbers from the config loader
- [ ] This PR changes a parameter value (Level 3, and the change is logged)

<!-- No hard-coded prices, wages, fees, taxes, timers or probabilities. Say so if you are certain. -->

## Screenshots or clip

<!-- Required for L1. Required for anything a player can see.
     Show it on a small screen, at the phone's real scale. -->

## Checklist — definition of done

- [ ] Works on the **preview deployment** (link: <!-- paste it -->)
- [ ] **Tests** added or updated and passing
- [ ] **CI is green** — lint, typecheck, tests
- [ ] I did **not** skip, delete, weaken or comment out a test to get here
- [ ] **Docs updated** in `street-boys-docs` if behaviour changed
- [ ] Any new **decision** logged in `docs/12-decisions-log.md`
- [ ] Any new **gap** added to `docs/13-parked-and-open-questions.md`
- [ ] Works on a **cheap Android phone on a slow connection**
- [ ] **No secrets, keys or personal data** in the diff
- [ ] **No new dependency**, or the reason is stated below
- [ ] No Base44 SDK, SDK call or database anywhere in the diff

## New dependencies

<!-- "None" is the expected answer. Otherwise: what it does, why an existing tool cannot, and its cost in bundle size. -->

## Anything the reviewer should know

<!-- Hidden risks, things you chose not to do, questions you had to answer,
     or a decision in docs/12 you think is wrong. Say it here rather than quietly deviating. -->
