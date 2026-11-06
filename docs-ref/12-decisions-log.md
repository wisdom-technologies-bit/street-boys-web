# 12 — Decisions Log

**Purpose:** Record every design decision as one numbered, dated line so the log is the single authority for what is settled.
**Status:** Decided

Every decision taken for v1 of the design. Date is the date the decision was recorded. If a doc and this log ever disagree, this log is right and the doc gets fixed.

All numbers referenced here are PLACEHOLDER, to be tuned by simulation.

## Vision and identity

- **D-001** — 2026-11-06 — Street Boys is a Nigerian street-life world where work, hustle, business, relationships, money, ambition, conflict and opportunity coexist.
- **D-002** — 2026-11-06 — Players start from almost nothing and build a life.
- **D-003** — 2026-11-06 — The wheelbarrow pusher and the business owner share one economy; the mechanic and the transport company depend on each other.
- **D-004** — 2026-11-06 — It is not a Lagos Life clone, not GTA, not a crime-only game, not a generic business sim, and not a crypto platform.
- **D-005** — 2026-11-06 — Money is plain naira (₦), never "coins" or "gems".
- **D-006** — 2026-11-06 — It is a browser game, mobile-first for cheap Android phones.

## World and city

- **D-007** — 2026-11-06 — The setting is one blended fictional city drawing on Aba (shoes, garments, tailors), Onitsha (wholesale, river port, bulk trade), Port Harcourt (oil money, waterfront, services, nightlife), Lagos (logistics, traffic, retail, entertainment) and Kano (textiles, leather, grain, northern transport).
- **D-008** — 2026-11-06 — The city must support this supply chain: Kano leather → Aba shoes → Onitsha bulk distribution → Lagos retail → Port Harcourt oil-money buyers.
- **D-009** — 2026-11-06 — Real public places may appear as landmarks (markets, motor parks, neighbourhoods); businesses and characters inside them are fictional.
- **D-010** — 2026-11-06 — No real private brands, politicians or parties, and no crime stories tied to real named businesses.
- **D-011** — 2026-11-06 — Later phase: each real city becomes its own map linked by interstate transport.
- **D-012** — 2026-11-06 — MVP has five zones: Market, Motor Park, Residential, Industrial, Downtown.
- **D-013** — 2026-11-06 — Presentation is a 2D top-down shared world map with tap-to-move, plus close-up "job scenes" for work.
- **D-014** — 2026-11-06 — Zones are separate rooms capped at about 50–100 players, with overflow instances.
- **D-015** — 2026-11-06 — The city follows real Nigerian time (WAT).
- **D-016** — 2026-11-06 — Language is Pidgin with light Igbo/Yoruba/Hausa phrases.

## Economy and ledger

- **D-017** — 2026-11-06 — One visible balance.
- **D-018** — 2026-11-06 — Money is transferable between players, with hidden protections rather than a visible rule list.
- **D-019** — 2026-11-06 — Hidden protections are: tiered transfer limits by account age and reputation, phone verification with one account per number, a pending period for large transfers, transfer tax above a threshold, pattern flags and freezes, daily top-up caps, and terms of service banning sale of in-game money for real money.
- **D-020** — 2026-11-06 — The ledger is double-entry and append-only: entries are never edited.
- **D-021** — 2026-11-06 — Every action carries an idempotency key.
- **D-022** — 2026-11-06 — The System account is the only place money is created or destroyed.
- **D-023** — 2026-11-06 — A Treasury account holds government money.
- **D-024** — 2026-11-06 — Faucets are: NPC-paid jobs, NPC customers, events, top-ups.
- **D-025** — 2026-11-06 — Sinks are: food, transport, rent, fuel, repairs, licences, taxes, fees, government leakage, system-sold property.
- **D-026** — 2026-11-06 — Prices, wages and costs are set by players wherever a player provides the service; NPC fallbacks at baseline prices always exist.
- **D-027** — 2026-11-06 — PLACEHOLDER: starting balance ₦5,000.
- **D-028** — 2026-11-06 — PLACEHOLDER: energy 100/day and about 10 energy per shift.
- **D-029** — 2026-11-06 — PLACEHOLDER: baseline active-day income about ₦20,000 against about ₦6,000 of unavoidable costs.
- **D-030** — 2026-11-06 — PLACEHOLDER prices: meal ₦1,000–2,500; transport ₦500–1,000; room rent ₦15,000/week; wheelbarrow ₦25,000; delivery bike ₦150,000; kiosk ₦300,000; small shop ₦500,000; house ₦1,000,000+.
- **D-031** — 2026-11-06 — Inflation is controlled by energy limits, diminishing returns on repeating a task, transfer tax, receive caps for new accounts, and wealth sinks that scale up.
- **D-032** — 2026-11-06 — An admin dashboard tracks money supply, money created vs destroyed per day, and wealth by tier.
- **D-033** — 2026-11-06 — Begging as a safety net at ₦0 is parked, and if built must not be farmable.

## Jobs and progression

- **D-034** — 2026-11-06 — There are no classes.
- **D-035** — 2026-11-06 — Skills grow by doing (Strength, Bargaining, Driving, Mechanics, etc.) and carry across jobs.
- **D-036** — 2026-11-06 — Ten launch occupations: Hawker, Wheelbarrow pusher, Loader, Conductor, Food seller, Mechanic apprentice, Delivery rider, Barber, Security guard, Market trader.
- **D-037** — 2026-11-06 — Agbero and taskforce are roles inside the group system, not jobs.
- **D-038** — 2026-11-06 — Four ways to climb: skill, capital, social, territory.
- **D-039** — 2026-11-06 — Reputation is several scores (Worker, Employer, Trader, Community, Heat) shown as one headline number plus a breakdown.
- **D-040** — 2026-11-06 — Survival pressure is energy, hunger, rest and rent.
- **D-041** — 2026-11-06 — Milestone moments are marked: first money, first stock, first employee, first property.
- **D-042** — 2026-11-06 — Anti-grind: repeated tasks pay less.
- **D-043** — 2026-11-06 — Leaderboards exist by category.

## Haggling and contracts

- **D-044** — 2026-11-06 — Each side in a negotiation has a hidden limit, and a deal is possible only if the limits overlap.
- **D-045** — 2026-11-06 — PLACEHOLDER: negotiations run 3–5 rounds with a patience meter.
- **D-046** — 2026-11-06 — Moves are: accept, counter, change quantity, "last price", walk away.
- **D-047** — 2026-11-06 — NPC limits shift with customer type, zone, time of day, weather/events, competition nearby, reputation and goods quality.
- **D-048** — 2026-11-06 — The server decides every haggling outcome, and NPC limits never reach the client.
- **D-049** — 2026-11-06 — Player-to-player haggling supports live and asynchronous offers with timeouts.
- **D-050** — 2026-11-06 — A "recently sold" price range is shown to players.
- **D-051** — 2026-11-06 — Hawkers stock up and set prices; wheelbarrow pushers estimate load weight and haggle the fee with the goods owner; conductor pay is set by the bus owner.
- **D-052** — 2026-11-06 — Every job is a recorded contract enforced by the server.
- **D-053** — 2026-11-06 — Pay types are: per task, daily wage, commission, weekly salary, daily remittance (owner sets a fixed amount, worker keeps the rest).
- **D-054** — 2026-11-06 — Escrow is used for task and daily jobs.
- **D-055** — 2026-11-06 — Salary default damages the owner's reputation and creates a worker claim.
- **D-056** — 2026-11-06 — Workers can cheat (e.g. pocketing fares), so owners need audits and NPC reports.
- **D-057** — 2026-11-06 — There is an apprenticeship path.
- **D-058** — 2026-11-06 — NPC employers always exist as a fallback.

## Groups, taskforce and government

- **D-059** — 2026-11-06 — One reusable group system (ranks, shared pot, rules, join vote) powers taskforce, Agbero crews, bus staff and market associations, and later gangs and families.
- **D-060** — 2026-11-06 — Taskforce joining ritual: before market opens the player approaches the crew, buys drinks, expresses interest, and each member (player or NPC) agrees or refuses.
- **D-061** — 2026-11-06 — Taskforce collects space fees from traders, who can pay, haggle, plead, hide goods or refuse.
- **D-062** — 2026-11-06 — At end of day the taskforce pot is shared and members choose how much to remit to the government, any amount.
- **D-063** — 2026-11-06 — Underpaying remittance risks a warning, then police arrest of the leader and market disruption.
- **D-064** — 2026-11-06 — Agbero demands money; victims can pay, haggle, refuse or call for help; refusing risks vandalism (repair costs); NPC police in an area can arrest an Agbero.
- **D-065** — 2026-11-06 — NPC members fill groups when few players are online.
- **D-066** — 2026-11-06 — Group systems have caps per trader per day and new-player protection.
- **D-067** — 2026-11-06 — Government is NPC-run at launch.
- **D-068** — 2026-11-06 — The Treasury receives remittances, licences, fines and fees.
- **D-069** — 2026-11-06 — Government announces projects (road, borehole, market stalls, police patrols) with a budget and a deadline.
- **D-070** — 2026-11-06 — A hidden corruption level decides whether projects are delivered, late, shoddy or abandoned.
- **D-071** — 2026-11-06 — Leakage is capped per day.
- **D-072** — 2026-11-06 — Money stolen by the NPC government is destroyed (a sink).
- **D-073** — 2026-11-06 — Project spending pays NPC contractors and re-enters circulation.
- **D-074** — 2026-11-06 — Players feel government through transport and repair costs, generator fuel, fewer police and higher fees.
- **D-075** — 2026-11-06 — Players see government clues through the budget board, radio/newspaper, trader gossip and half-built projects.
- **D-076** — 2026-11-06 — Later phases: player offices (market chairman, councillor, elections), whistleblowing, protests, journalists, court cases, bail.
- **D-077** — 2026-11-06 — All officials and parties are fictional.

## Property, business and marketplace

- **D-078** — 2026-11-06 — Limited plots per zone; scarcity creates value.
- **D-079** — 2026-11-06 — The system sells first plots, then players resell with a transfer fee.
- **D-080** — 2026-11-06 — Property carries running costs: ground fee/rent, property tax, repairs.
- **D-081** — 2026-11-06 — Seizure for unpaid tax happens only after a long grace period, with warnings.
- **D-082** — 2026-11-06 — A business is assets plus staff plus supply plus customers plus costs (revenue minus wages, fuel, maintenance, repairs).
- **D-083** — 2026-11-06 — The owner sets prices and wages.
- **D-084** — 2026-11-06 — Supply chains link players, businesses have management events, absent owners need a paid NPC manager, and growth is staged (stall, shop, branch).
- **D-085** — 2026-11-06 — A marketplace board lists goods, assets and job postings, with a fee on sales, bulk goods as quantities, escrow, expiring listings, and NPC buyers and sellers keeping it liquid.
- **D-086** — 2026-11-06 — Goods can spoil, wear out or be stolen.

## Crime, police, events and time

- **D-087** — 2026-11-06 — Crime is fictional storytelling with consequences, never a how-to.
- **D-088** — 2026-11-06 — Launch crimes are petty theft, extortion, scams and disputes.
- **D-089** — 2026-11-06 — Attempts are short risk-reward choices based on skill, location, police presence and witnesses.
- **D-090** — 2026-11-06 — Heat is a reputation score that decays over time.
- **D-091** — 2026-11-06 — Consequences are fines, arrest, jail (cannot act; bail or jail jobs), court case and reputation damage.
- **D-092** — 2026-11-06 — Victim tools are report, security guard, locks and police, with insurance later.
- **D-093** — 2026-11-06 — Protections: new-player immunity period, loss caps per incident and per day, targets are goods/stock/vehicles not the whole balance, property cannot be stolen outright, and a recovery window.
- **D-094** — 2026-11-06 — Kidnapping and hijacking are excluded from launch (NPC story events only), and there is no graphic violence.
- **D-095** — 2026-11-06 — Events are scheduled (market days, weekly concerts) and random (rain/flooding, road closures, shipment arrivals, urgent deliveries, construction sites), announced ahead where possible, each with a visible moment.
- **D-096** — 2026-11-06 — Police bribery is parked.

## Monetization and legal

- **D-097** — 2026-11-06 — Real-money top-ups are in at launch.
- **D-098** — 2026-11-06 — PLACEHOLDER: ₦10,000 should buy about a week of early progress, so the rate does not skip the game.
- **D-099** — 2026-11-06 — Large assets are gated by level, reputation or time played.
- **D-100** — 2026-11-06 — The real naira price is shown clearly on every purchase screen, with spending limits, confirmations, a clear refund policy and protections for minors.
- **D-101** — 2026-11-06 — Payments go through Paystack or Flutterwave, with secure webhooks.
- **D-102** — 2026-11-06 — Revenue order is top-ups, system-sold property, cosmetics, premium membership, then brand partnerships, sponsored events and branded locations.
- **D-103** — 2026-11-06 — Premium membership gives non-economic perks only, never higher pay.
- **D-104** — 2026-11-06 — Sponsorships are always labelled sponsored, never control prices or the economy, and are never tied to crime or corruption storylines.
- **D-105** — 2026-11-06 — Legal gate: no real money before review by a Nigerian fintech/gaming lawyer.
- **D-106** — 2026-11-06 — The lawyer must answer: (1) whether a transferable purchased balance is a wallet or e-money; (2) KYC/AML duties; (3) consumer protection and refunds (FCCPC); (4) data protection (NDPA); (5) tax/VAT on top-up sales; (6) enforceability of terms banning sale of in-game money.
- **D-107** — 2026-11-06 — The owner is not a lawyer and the monetization doc is not legal advice.

## Tech architecture

- **D-108** — 2026-11-06 — Four private GitHub repos: street-boys-docs (this repo), street-boys-web (Next.js front end, API routes, scheduled jobs; Vercel), street-boys-realtime (Colyseus; Railway or Fly.io; no money logic), street-boys-assets (tilemaps, sprites, UI, audio; later).
- **D-109** — 2026-11-06 — Database is Postgres (Neon or Supabase) with one ORM and migrations only; no Base44 database.
- **D-110** — 2026-11-06 — Rendering uses Phaser for the world map.
- **D-111** — 2026-11-06 — The Base44 Agent writes code inside the repos only.
- **D-112** — 2026-11-06 — The server is authoritative for all money, pay, haggle and arrest outcomes; clients send intentions only.
- **D-113** — 2026-11-06 — Secrets live in platform environment settings, never in repos.
- **D-114** — 2026-11-06 — Branches are main (live), staging, and a preview deploy per pull request.
- **D-115** — 2026-11-06 — The ledger module is the only code allowed to change balances and must have automated tests for total money balancing, no double payment, no negative balance and idempotent retries.

## MVP scope

- **D-116** — 2026-11-06 — MVP is one blended fictional city, five zones, about 10 occupations.
- **D-117** — 2026-11-06 — MVP core systems are accounts and character, ledger, transfers, survival loop, jobs, haggling, contracts, marketplace, property, businesses, groups, NPC government, police, world clock and events, profile and reputation, top-ups, admin and anti-abuse.
- **D-118** — 2026-11-06 — The MVP must not try to build everything at once.

## Parked

- **D-119** — 2026-11-06 — Parked: begging as a safety net; police bribery; player elections and offices; interstate multi-city maps; lawyer review before real money.

## Documentation

- **D-120** — 2026-11-06 — This repository contains design documentation only: no application code, no Base44 database or SDK, no dependencies, Markdown only.
- **D-121** — 2026-11-06 — `docs/14-economy-numbers.md` holds NPC BASELINE prices plus a PLAYER FLOOR and PLAYER CEILING for each item, not fixed prices, because prices, wages and costs are set by players wherever a player provides the service (D-026). The sheet is the fallback and the guardrail, never the price list.
- **D-122** — 2026-11-06 — The only code allowed in this repo is in `sim/`, written in Python 3 using the standard library ONLY (no pip installs, no packages, no database). It exists to test the placeholders in docs/14 and nothing else.

## Build rules

- **D-123** — 2026-11-06 — All money in every Street Boys repository is stored as **integer kobo** (`bigint`), never a float and never a decimal string, and is divided by 100 only in the display formatter.
- **D-124** — 2026-11-06 — The ORM is **Drizzle**, with SQL migrations only. No second ORM, no `drizzle-kit push` against a shared database, no ad-hoc schema edits.
- **D-125** — 2026-11-06 — Tests are written in **Vitest**.
- **D-126** — 2026-11-06 — Every external input is validated with **Zod** at the server boundary.
- **D-127** — 2026-11-06 — There are three review levels: **L1** presentation, **L2** game logic, **L3** money and trust (ledger, transfers, auth, payments, migrations, admin tools). An **L3 pull request is merged by the owner only**; an agent never merges one.
- **D-128** — 2026-11-06 — Economy parameters are **never hard-coded in code**. Every number from docs/14 lives in a versioned config table or file read through a typed loader, so the admin can change it without a redeploy, and every change is logged.
- **D-129** — 2026-11-06 — **Top-ups are blocked in `street-boys-web` until the lawyer review is complete** (the legal gate in docs/09). The system may be built behind a flag; the flag stays off until the review passes.
- **D-130** — 2026-11-06 — **Agents never push to `main`.** All work goes through a branch and a pull request, and CI must pass without weakening a test.

## Economy patch v2

- **D-131** — 2026-11-06 — Businesses pay a **stock cost of 55% of revenue** (PLACEHOLDER), destroyed as an NPC wholesale purchase. A business keeps a 45% margin; it is not free money.
- **D-132** — 2026-11-06 — **COLI (cost-of-living index)** replaces the "sticky NPC prices" assumption. One global index starting at 1.00, recomputed once per in-game month from money per active player: `COLI_next = COLI x (1 + clamp(k x (growth - target), -max_fall, +max_rise))`, with **+4% a month maximum rise and -1% a month maximum fall** (PLACEHOLDER). It scales NPC baseline prices, NPC wages and job pay, fixed fees and system-sold property prices; percentage charges follow. Player-set prices are untouched and their guardrails are percentages of the moving baseline. An **active player** is one who completed at least one shift in the last 7 days. The admin may override or freeze the index, and every change is logged.
- **D-133** — 2026-11-06 — The zero-balance target becomes a **band of 3% to 8%** of active players at ₦0 on any day after week 2, replacing the previous 10% ceiling. Under 3% the survival loop has no teeth.
- **D-134** — 2026-11-06 — **Survival costs rise modestly** to create pressure: hunger 55 to 75 a day (three meals), street meal ₦1,000 to ₦1,150, room rent ₦15,000 to ₦18,000 a week, transport ₦800 to ₦950 a trip. All PLACEHOLDER and all within 25% of v1. Begging stays parked (D-119).
- **D-135** — 2026-11-06 — The sink target gains **headroom**: the baseline sink ratio must be **at least 90% at both day 90 and day 180**, and must stay **at or above 80%** when every sink is cut by 30%.
- **D-136** — 2026-11-06 — Economy parameters live in **versioned config** (sim/config.json now, a versioned config table in the web app later), never hard-coded, read through a typed loader. This extends D-128 with the requirement that **every parameter change is logged** with who, when, old value, new value and reason.
- **D-137** — 2026-11-06 — **NPC prices, wages and fees are computed as base value x COLI** through one shared pricing function. Final prices are never stored; only base values and the index are.
