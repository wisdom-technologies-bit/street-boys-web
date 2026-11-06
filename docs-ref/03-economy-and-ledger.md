# 03 — Economy and Ledger

**Purpose:** Define the money model: one visible balance, protected transfers, an append-only double-entry ledger, the faucets and sinks that create and destroy money, and the placeholder numbers.
**Status:** Decided (all numbers PLACEHOLDER)

## The shape of the economy

- **One visible balance.** A player sees one naira figure. Not a wallet plus a bonus balance plus a locked balance.
- **Money is transferable between players.** Players can pay each other directly.
- **Prices, wages and costs are set by players** wherever a player provides the service.
- **NPC fallbacks at baseline prices always exist**, so a player is never stuck because no human counterpart is online.

That last pair is the core of the design: players set the real market, NPCs provide the floor and the liquidity.

## Transfers and hidden protections

Transfers are visible and free-feeling to the player, but the server applies protections the player does not see as a rule list. These exist because a transferable balance is a target for fraud, alt accounts and money laundering.

| Protection | What it does |
|---|---|
| **Tiered transfer limits** by account age and reputation | New and low-reputation accounts can move less |
| **Phone verification, one account per number** | Makes multi-accounting and mule accounts expensive |
| **Pending period for large transfers** | Large moves settle after a wait, giving time to catch fraud |
| **Transfer tax above a threshold** | Discourages laundering chains and acts as a sink |
| **Pattern flags and freezes** | Unusual movement (rings, rapid pass-through) is flagged and can be frozen |
| **Daily top-up caps** | Caps how much real money can enter per day |
| **Terms of service banning sale of in-game money for real money** | Makes the RMT trade a violation, not a supported feature |

Thresholds, limits, tier boundaries, the tax rate and the pending window are all PLACEHOLDER and undecided (see [13-parked-and-open-questions.md](13-parked-and-open-questions.md)).

## The ledger

The ledger is the part of the game that must never be wrong.

- **Double-entry.** Every movement is a pair of entries that balance.
- **Append-only.** Entries are never edited or deleted. A mistake is corrected by a new compensating entry, never a rewrite.
- **Idempotency key on every action.** The same action replayed (retry, double tap, network hiccup) must not move money twice.
- **The System account is the only place money is created or destroyed.** Every faucet is a System → player entry; every sink is a player → System entry. No other code path changes total money.
- **The Treasury account holds government money.** Remittances, licences, fines and fees land there, and government projects spend from it.

Implications:

- A balance is never set directly. It is derived from entries.
- Every game action that touches money carries an idempotency key: a job payout, a haggle settlement, a transfer, a tax, a fare.
- Ledger correctness is enforced in code with automated tests (see [10-tech-architecture.md](10-tech-architecture.md)).

## Faucets: where money enters

| Faucet | How it works |
|---|---|
| **NPC-paid jobs** | An NPC employer pays for work done |
| **NPC customers** | An NPC buys goods or a service from a player |
| **Events** | Scheduled or random events pay rewards |
| **Top-ups** | Real money bought naira enters the economy |

All faucets are System account → player. Money supply grows only here.

## Sinks: where money leaves

| Sink | What it costs the player |
|---|---|
| **Food** | Eating to survive |
| **Transport** | Moving between zones |
| **Rent** | Room and property rent |
| **Fuel** | Vehicles, generators |
| **Repairs** | Wear, damage, vandalism |
| **Licences** | Permission to trade, drive, operate |
| **Taxes** | Property tax and similar |
| **Fees** | Marketplace fees, transfer fees, space fees, transfer tax |
| **Government leakage** | Money stolen by the NPC government is destroyed |
| **System-sold property** | First plots and system assets are bought from the System |

Sinks must scale with wealth, so that a rich player still feels costs (see inflation controls below).

## Placeholder numbers

**Every number below is a PLACEHOLDER to be tuned by simulation. None of them is a balance decision.**

| Item | PLACEHOLDER value |
|---|---|
| Starting balance | ₦5,000 |
| Energy per day | 100 |
| Energy per shift | ~10 |
| Baseline active-day income | ~₦20,000 |
| Baseline unavoidable daily costs | ~₦6,000 |
| Meal | ₦1,000–2,500 |
| Transport between zones | ₦500–1,000 |
| Room rent | ₦15,000/week |
| Wheelbarrow | ₦25,000 |
| Delivery bike | ₦150,000 |
| Kiosk | ₦300,000 |
| Small shop | ₦500,000 |
| House | ₦1,000,000+ |

Reading the table as an intended curve, not a fact:

- A player starts with a few days of breathing room (₦5,000 against a ₦1,000–2,500 meal).
- 100 energy at ~10 per shift is about ten shifts a day.
- Ten shifts should roughly produce the baseline income, and the day should cost roughly a third of it.
- A wheelbarrow is about a day and a bit of profit; a delivery bike about a week; a kiosk and shop are real capital; a house is the long game.

The income-to-cost gap (₦20,000 vs ₦6,000) is deliberately wide at PLACEHOLDER because saving toward the asset ladder has to be possible. Simulation decides the real numbers.

## Inflation controls

Money only enters through faucets. If faucets outpace sinks, prices drift and the ladder becomes meaningless. The controls:

| Control | Effect |
|---|---|
| **Energy limits** | Caps how many paid actions a player can take per day, regardless of skill |
| **Diminishing returns on repeating a task** | The tenth wheelbarrow run pays less than the first |
| **Transfer tax** | Skims movement of money and discourages chains |
| **Receive caps for new accounts** | Stops a fresh account being used as a money dump |
| **Wealth sinks that scale up** | Costs grow with what a player owns, so owning more costs more |
| **Admin dashboard** | Money supply, created vs destroyed per day, and wealth by tier, watched constantly |

The dashboard is not a nice-to-have. It is how the team finds out the economy is inflating before the players do.

## Admin dashboard (economy view)

Required metrics:

- Total money supply, now and over time.
- Money created per day, by faucet.
- Money destroyed per day, by sink.
- Net creation per day.
- Wealth distribution by tier (how much money sits with the poorest players, the middle, the top).
- Top holders and top transfer patterns, for abuse review.

## Begging: parked

Begging as a **safety net at ₦0** is parked. If it ever ships, it must not be farmable. It is on the parked list, not in the MVP.

## Anti-abuse note

The transfer protections, the ledger's append-only nature, and the idempotency keys are one system working together: they make it hard to duplicate money and easy to see who tried.

## Related docs

- Where money is earned: [04-jobs-and-progression.md](04-jobs-and-progression.md)
- Where prices are agreed: [05-haggling-and-contracts.md](05-haggling-and-contracts.md)
- Where government money goes: [06-groups-taskforce-government.md](06-groups-taskforce-government.md)
- Where capital is spent: [07-property-business-marketplace.md](07-property-business-marketplace.md)
- Real money entering: [09-monetization-and-legal.md](09-monetization-and-legal.md)
- Ledger as code and tests: [10-tech-architecture.md](10-tech-architecture.md)
