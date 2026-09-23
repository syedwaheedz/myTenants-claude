# myTenants — calculation reference

A snapshot of every business-logic calculation in the app as of the
pre-redesign rollback point (git tag `pre-redesign-2026-09-24`, commit
`8e824e8`). Written as a reference to protect against the app-wide redesign
accidentally changing what a number *means*, even while its screen changes
completely. All functions below live in `Repo` (or as standalone helpers) in
`index.html`; line numbers will drift as the redesign proceeds — the
formulas and rules are the part that must survive unchanged unless the
redesign explicitly decides otherwise.

## Rent accrual

**`rentRateForMonth(tenant, mk)`** — a tenant's rent can change over time.
`tenant.rent_history` is `[{effective_month, rent}]` sorted ascending; a
given month's rate is whichever entry's `effective_month` is the latest one
`<= mk`. Tenants created before this existed have no `rent_history` — falls
back to a single implicit entry at `tenant.monthly_rent` from their
`start_date`.

**`Repo.accrueMonthlyRent(tenant)`** — walks every month from
`tenant.last_accrual_month` up to the current real-world month, adding
`rentRateForMonth` for each, onto `tenant.current_balance` (a running total:
positive = owed by the tenant). Run automatically on every tenant read
(`runDueAccruals`) so balances never silently go stale just because nobody
opened the app for a while.

**`Repo.correctCurrentRent`** vs **`Repo.scheduleRentChange`** — two
different rent-history edits. *Correct* retroactively fixes a mistake in the
already-accrued current rate (adjusts past months via a balance adjustment).
*Schedule* adds a new `rent_history` entry taking effect from a chosen
future month, leaving past accrual untouched.

## Tenant balance & historical reconstruction

**`Repo.tenantBalanceAsOf(tenantId, mk)`** — a tenant's *true* balance as of
the end of a given month, recomputed from scratch from their full
transaction history filtered to that cutoff — never read from today's
stored `current_balance`, so a historical snapshot stays accurate even after
today's balance has moved on. `cumDue` = sum of `rentRateForMonth` from the
tenant's start month through the cutoff; `cumPaid` = sum of
`(total_amount + repair_amount)` for every non-voided RENT_PAYMENT, plus
`adjustment_amount` for every non-voided ADJUSTMENT, dated at-or-before the
cutoff (using **`txnEffectiveDate(x)`**, not the raw date — see below).
Returns `cumDue - cumPaid`.

**`txnEffectiveDate(x)`** — a RENT_PAYMENT's date, *for month-cutoff/
bucketing comparisons only*, is overridden by `x.for_month` when set (lets a
payment received in month X be earmarked for month X-1's rent, for tenants
who customarily pay a month behind). Falls back to `x.date`. ADJUSTMENT rows
always use their own `date` — no lag concept for a manual correction.

**`Repo.arrearsAsOf(mk)`** — sum of `tenantBalanceAsOf` across every tenant,
counting only positive balances (a credit/advance doesn't offset someone
else's arrears in the total).

## Monthly Paid / Partial / Due status (oldest-debt-first)

**`Repo.monthlyTenantStatusFromTxns(tenant, mk, txnsForTenant)`** — the
core, most load-bearing calculation, and the one most fixed-for-bugs this
session. For a given tenant and month:

1. `priorArrears` = cumulative due minus cumulative paid for every month
   *before* `mk`, using the same `txnEffectiveDate`-aware cutoff as
   `tenantBalanceAsOf`.
2. `due` = `rentRateForMonth(tenant, mk)` — this month's rent only.
3. `paid` = sum of RENT_PAYMENT amounts whose *effective* month
   (`x.for_month || monthKey(x.date)`) equals `mk`.
4. **`appliedToCurrentMonth`** = `max(0, min(paid - max(0, priorArrears), due))`
   — prior arrears are settled first; only what's left over can count
   toward the current month. This is the fix for the "paying exactly this
   month's rent while carrying old arrears shows as Paid" bug: a raw
   payment-dated-this-month figure is never compared directly against
   `due` anymore.
5. `status` = `"paid"` if `appliedToCurrentMonth >= due - 0.005`,
   `"partial"` if `> 0.005`, else `"due"`.

Every consumer of monthly status (Dashboard's progress bar, the property
monthly toggle, the PDF report, the monthly snapshot's per-property
breakdown) uses `appliedToCurrentMonth`, never raw `paid` — kept
consistent deliberately so a tenant can't look "Due" on one screen and
"fully collected" on another for the same reason.

## Partner settlement

**`Repo.computeSettlement(fromPeriod, toPeriod, ownerRentPayerOverrides)`**
— reconciles who's *actually holding* collected cash against what each
partner's *entitled to*. All monetary logic in one function:

- `relevantSplits` = unsettled, non-voided transaction_splits whose parent
  transaction's month falls within `[fromPeriod, toPeriod]` (inclusive
  range — settling several unsettled months in one pass is safe because
  only genuinely-unsettled splits are ever touched; overlapping an
  already-settled month just contributes zero for it).
- `grossCollected` = sum of those splits' amounts.
- `ownerRentTotal` = sum of every property's `owner_rent_amount` ×
  `monthsInRange` (months are counted inclusively via `monthsBetween + 1`).
- `finalTotal` = `grossCollected - ownerRentTotal` — the pool actually
  split between partners.
- Per property with an owner-rent obligation, **`ownerRentByProperty`**
  records who collected it this period (`collectedBy`, grouped by
  receiver/partner) — or, if `ownerRentPayerOverrides` names a specific
  partner for that property, **that partner takes on the property's whole
  obligation instead of the collection-based inference** (for when someone
  other than the collector actually pays the owner, e.g. out of personal
  funds).
- **`ownerRentResponsibilityByPartner`** rolls the above up per partner:
  with no override, a property's `total` is split proportionally across
  whoever collected it (weighted by their share of that property's
  collections); with an override, 100% goes to the named partner. A
  property with zero collections and no override contributes its whole
  `total` to **`ownerRentUnattributed`** instead of silently defaulting to
  0 on some partner's row.
- Per partner: `share = finalTotal × share_percent/100`;
  `entitled = share + opening_balance` (opening balance = their carried
  `running_balance` from the last settlement or manual adjustment);
  `ownerRentResponsibility` / `availableAfterOwnerRent` as above
  (`collected - ownerRentResponsibility`, not clamped — can go negative);
  **`net = entitled - availableAfterOwnerRent`** (not raw `collected` —
  this is what makes an owner-rent-payer override automatically fold the
  right reimbursement into the suggested transfer, proven by hand and in
  `tests/calculations.test.js` to be identical to the simpler
  `entitled - collected` whenever nobody's on the hook for any owner rent).
- **Suggested transfers**: greedy debtor/creditor netting on `net` — sort
  debtors (`net < -0.004`) and creditors (`net > 0.004`) descending by
  magnitude, repeatedly match the largest pair until one side is
  exhausted. Minimizes the number of transfers needed, not necessarily
  matching any particular "fairness" ordering beyond that.

**`Repo.recordSettlement(period, computed, transferAmounts)`** — persists
whatever `computeSettlement` returned. For each transfer,
`transferAmounts[idx]` is how much was *actually* paid (can be less than
suggested — partial settlement); `remaining = suggested - paid` carries
forward. For each partner, `closing = net - movement` (movement = received
minus paid this round) becomes their new `running_balance` — this is what
lets a partial settlement's shortfall show up as next period's opening
balance automatically. Marks every split covered by the period as
`settled_at = now`.

**`Repo.recordManualTransfer(from, to, amount, note, date)`** — a
standalone correction (not tied to any computed settlement) for a
retroactive debt between two partners discovered outside the normal flow —
same `partner_transfers` ledger, immediately marked `paid` (records fact,
doesn't suggest/await payment).

## Cash in hand

**`Repo.cashInHandByReceiver()`** / **`cashInHandByPartner()`** — live
(not historical) totals: sum of every unsettled, non-voided split's amount,
grouped by receiver, then rolled up to the partner each receiver reports
into. A receiver with no `partner_id` contributes to `unassigned` instead of
any partner's total.

## Reporting aggregates

- **`Repo.totalCollectedForMonth(mk)`** — raw sum of RENT_PAYMENT
  `total_amount` dated (by real calendar date, not `for_month`) in `mk`.
  Deliberately date-based, not `for_month`-based or oldest-debt-first-based
  — this is a cash-flow figure ("how much actually came in this month"),
  answering a different question than the Paid/Partial/Due status above.
- **`Repo.monthlyCollections(n, endMonth)`** — the last `n` months' worth of
  `totalCollectedForMonth`, for the trend chart. Same date-based rule.
- **`Repo.portfolioTotals`**, **`defaultersAsOf`**, **`arrearsByProperty`**
  — straightforward counts/sums built from the functions above; no
  independent logic of their own.

## Explicitly *not* using `for_month` (stay date-based on purpose)

`computeSettlement`, `totalCollectedForMonth`, `monthlyCollections`, and the
tenant ledger's chronological ordering all use the transaction's real
`date`, never `for_month`. These answer "when did cash physically move",
which doesn't change just because a payment is earmarked for a different
rent-month. Only the Paid/Partial/Due family of calculations
(`monthlyTenantStatusFromTxns`, `tenantBalanceAsOf`, `arrearsAsOf`, and
anything built from them) is `for_month`-aware.
