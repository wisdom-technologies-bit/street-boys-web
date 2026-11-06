# 14 — Economy Numbers Sheet

**Purpose:** Hold every NPC baseline price, cost and limit the game needs, with the player floor and ceiling that guard it, so the simulation and the build work from one set of numbers.
**Status:** Placeholder (every number here is a starting value to be tuned by simulation; see [15-simulation-report.md](15-simulation-report.md)). **v2 patch applied**: cost-of-living index, business stock cost and stronger survival costs (D-131 to D-134).

## How to read this sheet

The design rule from [03-economy-and-ledger.md](03-economy-and-ledger.md) is that **prices, wages and costs are set by players** wherever a player provides the service. So this sheet does not set prices. It sets three things:

| Column | Meaning |
|---|---|
| **NPC baseline** | The fallback an NPC always offers. This is the floor of the market and the price a player sees when no human is available. |
| **Player floor** | The lowest a player-provider may charge for the same thing. Below this, the offer is refused. |
| **Player ceiling** | The highest a player-provider may charge. Above this, the offer is refused. |

Between floor and ceiling, the player is free, and haggling decides what actually happens (see [05-haggling-and-contracts.md](05-haggling-and-contracts.md)).

Two further conventions:

- **PLACEHOLDER** applies to every number on this page. Nothing is a balance decision.
- **These numbers are implemented in `sim/config.json`.** That file is the machine-readable copy. If the two ever disagree, `config.json` is what the simulation actually ran, and this page is wrong.

## 0.5 The cost-of-living index (COLI)

Everything on this sheet is a **base value**. What a player actually pays or is paid is:

> **final price = base value × COLI**

COLI is one global number. It starts at **1.00** and is recomputed **once per in-game month (30 days)**. Final prices are **never stored**: the database holds base values and the index, and multiplies them at the moment of use (D-132).

**What the index scales.** NPC baseline prices (meals, transport, rent, NPC-sold goods and services), NPC wages and NPC job pay, fixed fees (licences, fixed fines), and system-sold property prices. Percentage-based charges (property tax at 0.08%, transfer tax at 2%) follow automatically, because they are a share of an already-scaled amount.

**What it does not touch.** Prices that players set. Guardrails still hold, but they are expressed as a **percentage of the NPC baseline** (the `floor_pct` and `ceiling_pct` columns below), so the floor and ceiling move with the index while the player stays free between them.

**The update rule.**

```
COLI_next = COLI × (1 + clamp(k × (money_per_active_player_growth − target_growth),
                              −max_fall, +max_rise))
```

| Parameter | Base value (PLACEHOLDER) | Meaning |
|---|---|---|
| `period_days` | **30** | Recount once an in-game month |
| `k` | **0.5** | How hard the index reacts to money growth |
| `target_growth` | **0%** | Money per active player growing faster than this pushes prices up |
| `max_rise` | **+4% per month** | The ceiling on a single month's increase |
| `max_fall` | **−1% per month** | The floor, so prices never crash (no deflation shock) |
| `floor` / `ceiling` | **0.80 / 4.00** | Absolute bounds on the index |

**"Active player"** means a player who completed **at least one shift in the last 7 days**. Players who have stopped playing still hold money, and counting them would let an idle population drive prices around. Only people actually working the street move the index.

**Admin control.** The admin can **override or freeze** the index. Every override, freeze and unfreeze is **logged** with who, when, the old value, the new value and the reason. That logging is a requirement for the admin tools, not an optional extra.

**Why it replaces sticky prices.** v1 assumed NPC prices barely moved while money per player grew 49×, which made the inflation target pass on an assumption rather than an economy (see [15-simulation-report.md](15-simulation-report.md), Problem 3). COLI makes prices respond to money growth on a rule instead.

## 1. Survival costs

| Item | NPC baseline | Player floor | Player ceiling | Notes |
|---|---|---|---|---|
| Street meal | **₦1,150** | ₦805 | ₦2,300 | Restores 30 hunger. **Three a day** keeps a player fed (v2: +15%) |
| Proper meal | ₦2,500 | ₦1,800 | ₦4,000 | Restores more hunger and buys goodwill. **Not yet modelled in the sim** (it only buys street meals). |
| Transport trip (zone to zone) | **₦950** | ₦600 | ₦1,786 | Two trips a day is the working assumption (v2: +18.75%) |
| Room rent, per week | **₦18,000** | ₦14,400 | ₦30,060 | Paid every 7 days from the player's join date (v2: +20%) |
| Sleeping rough penalty | 25 energy | 15 energy | 40 energy | Applied the next day when rent cannot be paid. Not a money cost: it costs you the day. |

PLACEHOLDER for hunger: **75** hunger per day against a 30 restore means a player must eat **three times** (v1 was 55, two meals). The meter is capped at 100. All three survival prices above moved by less than 25% from v1 (D-134).

## 2. Entry job pay per shift, and energy cost

Pay is for **one shift**. Energy is what that shift costs from the daily allowance. For jobs a player provides (hawker, food seller, barber), the pay column is the **NPC-employer fallback** the player can always take.

| Job | NPC baseline pay | Player floor | Player ceiling | Energy per shift | Notes |
|---|---|---|---|---|---|
| Hawker | ₦2,800 | ₦1,700 | ₦4,800 | 10 | Player-priced: stocks up, sets prices |
| Wheelbarrow pusher | ₦3,200 | ₦2,000 | ₦5,500 | 14 | Fee haggled with the goods owner |
| Loader | ₦3,700 | ₦2,300 | ₦6,400 | 16 | Heaviest energy cost, best unskilled pay |
| Conductor | ₦2,500 | ₦1,600 | ₦4,300 | 9 | Cheapest energy; remittance sets the real income |
| Food seller | ₦2,900 | ₦1,800 | ₦5,000 | 10 | Player-priced |
| Mechanic apprentice | ₦3,450 | ₦2,200 | ₦5,900 | 12 | Apprenticeship path (see docs/05) |
| Delivery rider | ₦4,100 | ₦2,600 | ₦7,100 | 12 | Best pay, but a bike costs fuel every day |
| Barber | ₦2,400 | ₦1,500 | ₦4,100 | 8 | Player-priced, lowest energy |
| Security guard | ₦2,200 | ₦1,400 | ₦3,800 | 8 | Low pay, low energy, useful for a second job |
| Market trader | ₦3,300 | ₦2,100 | ₦5,700 | 10 | Needs stock; the ladder starts with a kiosk |

**Energy allowance: 100 per day** (PLACEHOLDER, from docs/03), regenerated daily. That is roughly 6 to 12 shifts depending on the job, which is the real cap on a day's earnings regardless of skill.

**Anti-grind (PLACEHOLDER):** the first **4 shifts** of a day pay in full. Each extra shift of the same task pays **12% less**, down to a floor of **45%** of baseline. So the 10th shift pays about half the first.

## 3. Assets

Assets are system-sold, so buying one is a **sink**: the money leaves the player and is destroyed. Price and access are deliberately separate.

| Asset | Price | Target days of saving | Income multiplier | Daily running cost | Access gate | Notes |
|---|---|---|---|---|---|---|
| Wheelbarrow | ₦25,000 | 1–3 days | ×1.10 | none | none | The first rung. Almost everyone buys it on day 1–2. |
| Delivery bike | ₦150,000 | 8–14 days | ×1.25 | ₦700 fuel | 3 days, rep 5 | Best early multiplier, but fuel is a daily sink |
| Kiosk | ₦300,000 | **21–35 days** | ×1.10 | ₦600 staff | 14 days, rep 10 | **The measured milestone** (see target 2) |
| Small shop | ₦500,000 | 40–55 days | ×1.15 | ₦1,200 staff | 28 days, rep 20 | +₦3,000/day NPC customers |
| Workshop | ₦800,000 | 60–75 days | ×1.20 | ₦400 fuel, ₦2,000 staff | 35 days, rep 25 | +₦5,000/day NPC customers |
| House | ₦1,000,000 | 75–95 days | none | ₦300 fuel | 60 days, rep 25 | A home, not an earner |
| Warehouse | ₦1,200,000 | 90–115 days | ×1.25 | ₦1,200 fuel, ₦3,200 staff | 45 days, rep 30 | +₦8,000/day NPC customers |
| Luxury house | ₦3,000,000 | 180–240 days | none | ₦900 fuel, ₦2,500 staff | 90 days, rep 40 | Long game; almost nobody reaches it in 90 days |

**"Target days of saving"** assumes an average active player clearing about ₦13,000–₦15,000 a day after essentials. It is a design target, not a measurement; the simulation measures what actually happens.

**Passive income** (the "+₦X/day NPC customers" column) is what a business earns from NPC walk-in trade. A business owner who is not there still needs a paid NPC manager (D-084), which is why every business asset carries a daily staff cost.

**Income multiplier** is how much better the player's own shifts pay once they own the tool. Multipliers compound, which is why the ladder stays modest: all eight assets together multiply a shift by about ×1.9.

**Access gates** exist so money cannot buy status (D-099): the asset needs days played and reputation as well as naira.

## 4. Fees and taxes

| Fee or tax | Value | Paid by | Where it goes | Notes |
|---|---|---|---|---|
| Transfer tax | Free under **₦50,000**; **2%** above | Sender | Destroyed | A sink, and a brake on laundering chains |
| Marketplace sale fee | **5%** of sale | Seller | Destroyed | Not yet modelled in the sim |
| Property tax | **0.08% per day** of asset value (≈29% a year) | Owner | Treasury | Scales with what the player owns (D-031) |
| Repairs | **0.05% per day** of asset value (≈18% a year) | Owner | Destroyed | Vehicles and machines wear |
| Business licence | **₦2,000 per week** | Business owner | Treasury | Listed for the design; not yet modelled |
| **Business stock cost** | **55% of business revenue** | Business owner | Destroyed (stock bought from NPC wholesalers) | A business keeps a **45% margin**. Without it, a kiosk was free money (D-131) |
| Taskforce space fee | **₦300–₦1,200 per trader per day** | Trader | Taskforce pot, then partly Treasury | Range, because the crew decides |
| Police fine, minor | **₦2,000–₦5,000** | Offender | Treasury | |
| Police fine, serious | **₦10,000–₦25,000** | Offender | Treasury | 15% of fines are serious |

Fine probability: **1% of active players per day** (PLACEHOLDER), which is what makes a bad day possible without making it common.

## 5. Government

NPC-run at launch (D-067). Everything below flows through the Treasury account (D-023, D-068).

| Item | Value | Notes |
|---|---|---|
| Starting Treasury | **₦500,000** | Seed money so the first project is possible |
| Remittance expectation, small market | ₦40,000/day | What the crew is "supposed" to hand over |
| Remittance expectation, medium market | ₦80,000/day | |
| Remittance expectation, large market | ₦150,000/day | |
| Actual remittance | **30%–100% of the pot**, chosen by the members | Voluntary (D-062), so random in the sim |
| Underpayment threshold | below **50%** of the pot | Triggers a warning, then risk of arrest |
| Arrest chance if underpaid | **15% per day** | Fine of ₦10,000–₦25,000 plus reputation loss |
| Project interval | every **14 days** | Budget ₦400,000–₦2,500,000, spent over 10 days |
| Leakage cap | **₦150,000 per day** | Hard ceiling on theft (D-071) |

### Corruption levels

| Level | Leakage per day | Chance a project is delivered | What the player experiences |
|---|---|---|---|
| Low | **8%** of Treasury | 85% | Projects mostly appear, roughly on time |
| **Medium (default)** | **22%** of Treasury | 60% | Some projects late or shoddy, some never |
| High | **45%** of Treasury | 35% | Half-built sites everywhere, rising fees |

Leaked money is **destroyed**, never pocketed and re-spent (D-072). A project that is not delivered leaves its money stuck in a half-built site, out of circulation. A project that is delivered pays players acting as contractors, so the money comes back into the street.

## 6. Top-up packages

Real naira to in-game naira. The anchor from [09-monetization-and-legal.md](09-monetization-and-legal.md) is that **₦10,000 buys about one week of early progress**. An early player nets roughly ₦14,000 a day, so a week is about ₦98,000 in game money. The ₦10,000 package pays ₦110,000, which is 7.8 days. That is the anchor holding.

| Package | Real price | In-game naira | Bonus | Notes |
|---|---|---|---|---|
| Starter | ₦500 | ₦5,000 | 0% | One day of early progress |
| Small | ₦1,000 | ₦10,000 | 0% | |
| Standard | ₦2,500 | ₦26,000 | 4% | |
| Popular | ₦5,000 | ₦54,000 | 8% | |
| Big | ₦10,000 | ₦110,000 | 10% | **The anchor package** |
| Whale | ₦20,000 | ₦220,000 | 10% | Bonus capped at 10% (D-102 spirit) |

| Limit | Value |
|---|---|
| Daily top-up cap per account | **₦20,000 real** |
| Monthly top-up cap per account | **₦50,000 real** |

The caps are what stop purchased money from skipping the game even if the package table tempts. A player hitting the monthly cap has bought about two months of early-progress money, and still cannot buy a kiosk's access gate.

### What money cannot buy

Assets are gated by **days played and reputation** as well as price (table 3). A fresh account with ₦10,000,000 cannot buy a warehouse: it needs 45 days and reputation 30 first. Money buys options inside the ladder, never a place at the top of it.

## 7. Transfer limits by account tier

| Tier | Requirement | Send per day | Receive per day | Pending period above |
|---|---|---|---|---|
| **New** | 0 days | ₦20,000 | ₦30,000 | ₦10,000 |
| **7-day** | 7 days played | ₦75,000 | ₦120,000 | ₦25,000 |
| **30-day** | 30 days played | ₦300,000 | ₦500,000 | ₦100,000 |
| **Trusted** | 60 days + reputation 50 | ₦1,000,000 | ₦1,500,000 | ₦400,000 |

A transfer above the pending threshold settles **the next day** rather than instantly. That is the pending period (D-019), and it exists to give fraud detection one window to look.

## 8. Starting state

| Item | Value | Notes |
|---|---|---|
| Starting balance | **₦5,000** | About two days of breathing room (D-027) |
| Starting energy | **100** | |
| Daily energy regeneration | **100 per day** | Reset each day, not trickled |
| Hunger | **55 per day**, meter capped at 100 | Two meals a day |
| Meal restore | **30 hunger** | |
| Hungry penalty | **20 energy** | Applied when hunger is above 70% of the meter |
| Starting assets | none | Everyone starts at zero assets |
| Starting reputation | 0 | Grows about 1.2 per active day |

## 9. Target bands

The health targets the simulation must check. All PLACEHOLDER.

| # | Target | Band | Why it matters |
|---|---|---|---|
| T1 | Average active new player nets per day | **₦10,000 – ₦15,000** | The game must feel worth a day's play without being a tap-to-earn |
| T2 | Time to first kiosk | **3 – 5 weeks** (21–35 days) | The first real "I built something" moment |
| T3 | Players at zero on any day after week 2 | **3% – 8%** (a band, not a ceiling) | Survival pressure. Under 3% the loop has no teeth (v1 was 0.2%); over 8% it is a death spiral |
| T4 | Long-run daily money destroyed vs created | **85% – 100%**, excluding top-ups | The economy must not inflate away |
| T4b | **Headroom**: the sink ratio at day 90 **and** day 180 | **≥ 90%** | At least 5 points above the 85% floor, so one shock cannot knock it under |
| T4c | Sink ratio when every sink is cut 30% | **≥ 80%** | The floor under a stress test, not just the happy path |
| T5 | Basket price index (meals, transport, rent) | **≤ 5% per month, with COLI on** and no assumption of sticky NPC prices | Prices must feel stable, and the pass must come from the rule, not from an assumption |
| T6 | Wealth concentration (Gini) at day 90 | **< 0.75** | A city of paupers and one landlord is not a city |

## 10. A day in numbers

A regular player, day 20, no assets beyond a wheelbarrow:

| Line | Amount |
|---|---|
| 6 loader shifts, ₦3,700 baseline, 4 free then diminishing | ₦20,868 |
| × wheelbarrow multiplier | ₦22,955 |
| Food, two street meals | −₦2,000 |
| Transport, two trips | −₦1,600 |
| Rent, one seventh of the week | −₦2,143 |
| Wheelbarrow repairs and tax | −₦33 |
| **Nets** | **≈ ₦17,000** |

A casual player (4 hawker shifts) nets about ₦6,800 before any asset, which is the thin margin the design wants at the bottom.

## 11. What this sheet does not decide

Every number here is a proposal to be proven by the simulation. What the sheet does **not** decide is listed in [13-parked-and-open-questions.md](13-parked-and-open-questions.md), including: the skill curve, the reputation formula, jail and bail, the marketplace fee rules, licence types, plot counts per zone, and every number this page simply does not mention.

## 11b. The cost of living on the street (for later web prompts)

COLI is not only a number in a config table. It is a **public figure in the city**, and the player should meet it before they understand it.

- The phone shows a **cost-of-living figure** in the HUD, moving once a month, next to the day and the player's balance. A player who ignores it should still have seen it.
- **NPC radio** drops lines like "Cost of living don go up again this month" and "Transport fare don increase, oga". The line names the thing that got dearer, not the index.
- **Newspaper/proclamation events** announce a monthly figure, and market traders argue about it. A player who raises prices at the wrong moment should hear about it from customers, not from a tutorial.
- The index is **never shown as a decimal** to players. It is a sentence ("things cost 8% more than when you started"), or a price they recognise going up.

These lines exist so that an inflation mechanic feels like a city, not like a spreadsheet. They are content to write later; they are listed here so the web prompts do not forget them.

## 12. Where this sheet differs from docs/03

Four refinements were made while building the simulation, because the original placeholders could not be simulated as written. They are listed with reasons in [15-simulation-report.md](15-simulation-report.md):

1. **Energy per shift** is now 8–16 by job, instead of "~10 for every job".
2. **Pay per shift** is now specified for all ten jobs.
3. **Property costs** were split into property tax, repairs, fuel and staff wages, all scaling with what a player owns.
4. **Business stock** (cost of goods) was added as a concept, and is a proposed change rather than a current number (see the report).

## 13. Implementation notes for street-boys-web

For the agent building `street-boys-web` (see [AGENTS.md](../AGENTS.md) and [templates/AGENTS.web.md](../templates/AGENTS.web.md)):

1. **Final prices are computed, never stored.** Every money column holds a **base value**. Every price, wage and fee a player sees is `base × COLI`, calculated through **one shared pricing function**. Nothing else may multiply by the index.
2. **One pricing function.** Jobs, shops, meals, rent, transport, licences, fines and property sales all call the same function. If two modules compute a price two ways, the economy has two economies.
3. **Config is versioned.** The numbers live in a versioned config table (or a versioned config file), read through a typed loader, never hard-coded. Changing a parameter is a Level 3 action.
4. **Every config change is logged.** Who, when, which key, old value, new value, reason. The same log carries COLI overrides and freezes.
5. **COLI is recomputed once per in-game month**, from money per active player, using the rule in §0.5. It is a scheduled job, and it must be idempotent: running twice in a month must not double the index.
6. **Active means worked.** "Active player" is at least one shift in the last 7 days, computed from shift records, not from a login timestamp.

## Related docs

- The money model these numbers live inside: [03-economy-and-ledger.md](03-economy-and-ledger.md)
- Jobs and skills: [04-jobs-and-progression.md](04-jobs-and-progression.md)
- Haggling over the floor and ceiling: [05-haggling-and-contracts.md](05-haggling-and-contracts.md)
- Taskforce fees and government budgets: [06-groups-taskforce-government.md](06-groups-taskforce-government.md)
- Asset ladder and business costs: [07-property-business-marketplace.md](07-property-business-marketplace.md)
- The top-up anchor: [09-monetization-and-legal.md](09-monetization-and-legal.md)
- **What the numbers actually did:** [15-simulation-report.md](15-simulation-report.md)
- **The machine-readable copy:** [`sim/config.json`](../sim/config.json)
