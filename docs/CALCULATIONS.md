# myTenants — how the numbers are calculated

Plain-language reference for the actual logic behind every calculation in
the app — not the code, the *reasoning* — so the upcoming redesign can
change how things look without changing what a number means. Written as of
the pre-redesign rollback point (git tag `pre-redesign-2026-09-24`).

## 1. How much rent is due each month

Each tenant has a monthly rent amount. If the rent changed at some point
(an increase, a correction), the app remembers **when** each rate started
and always uses whichever rate was actually in effect for a given month —
never applies today's rate backward onto past months.

## 2. Has this month's rent been paid? (Paid / Partial / Due)

This is the most important rule in the app, and the one most bugs have
come from getting wrong.

> **Any payment settles the oldest debt first, before it can count toward
> the current month.**

Step by step, for a tenant and a specific month:

1. **What was still owed from before this month** =
   (all the rent that should have accumulated every month from when they
   moved in, up through *last* month)
   − (every payment and balance adjustment dated before this month).
2. **What's left over for this month** = (money paid *this* month) −
   (whatever was still owed from before, if anything) — clamped to zero if
   the old debt was bigger than this month's payment.
3. **Applied to this month** = the leftover from step 2, capped at this
   month's rent (a payment can't count as "more than fully paid").
4. **Status**: Paid if the applied amount covers the full rent, Partial if
   it covers some but not all, Due if none of it got through step 2 at all.

The practical effect: a tenant who pays exactly one month's rent while
still owing from several months back shows as **Due**, not Paid — that
payment was needed to catch up on the past, not to cover the present.

## 3. How much does a tenant owe right now — or as of any past date?

> Balance = (every month's rent added up, from move-in through the cutoff
> date) − (every payment and adjustment recorded up to that same cutoff).

This is always recalculated fresh from the full history, never read from a
single stored "current balance" number — so asking "what did they owe as
of March" gives the historically correct answer for March, even if
everything has changed since.

## 4. Splitting collected rent between partners (settlement)

For a chosen period (one month, or several at once):

1. **Add up** every rent payment collected in that period that hasn't
   already been settled.
2. **Subtract** the property owner's fixed monthly rent (for however many
   months are in the period) — what's left is the amount actually up for
   sharing between the partners.
3. **Each partner's fair share** = their percentage × that shareable
   amount, **plus** anything carried over as still owed to them from a
   previous settlement round.
4. **Compare** that fair share against what each partner is actually
   holding (see §6 for whose hands the cash is in), after first setting
   aside whatever owner's-rent portion that specific partner is on the
   hook to pay (see §5).
5. Whoever is holding **less** than their fair share is owed the
   difference; whoever is holding **more** owes the difference out. The
   app works out the smallest possible number of partner-to-partner
   payments that gets everyone to their fair share.

## 5. Who's actually responsible for paying the property owner

For each property with a fixed owner-rent amount: by default, whoever
*collected* that property's rent this period is treated as the one who
needs to pay the owner, straight out of what they collected. If more than
one partner's receiver collected from the same property, the owner's rent
is split between them in proportion to how much each one collected.

If nobody has collected anything for that property yet this period, nobody
is currently holding cash to pay the owner from — the app flags this
plainly instead of quietly pretending it's already been dealt with.

You can also explicitly say a *different* partner actually paid the owner
— e.g. one partner covers it from their own pocket instead of the partner
who happened to collect the tenant's rent. When that's recorded, the fair
split in §4 automatically accounts for it: the partner who fronted the
payment gets credited the full amount back, on top of whatever they were
already owed for the normal rebalancing.

## 6. Cash currently sitting with each person

> For each receiver: add up every payment they've collected that hasn't
> been through a settlement yet.

Then roll each receiver's total up to whichever partner they collect on
behalf of, to get "how much is each partner's side actually holding right
now" — a live, real-time figure, not something you have to run a
settlement to see.

## 7. "Collected this month" and the collections trend

Simply: every rent payment **dated** within that calendar month, added up
— a plain cash-flow number ("how much money actually came in this
month"), independent of which month's rent that money was intended to
cover (that's the separate question §2 answers). A payment can be dated in
September but be intended to cover August's rent — both stay true at once,
answering two different questions.

## What stays fixed no matter how the screens change

- §2 and §3 (Paid/Partial/Due, and historical balance) are the ones every
  other screen's "is this tenant paid up" figure must ultimately agree
  with — Dashboard, Defaulters, the monthly toggle, and every export.
- §4–§6 (settlement, who pays the owner, cash on hand) must always net out
  consistently: what everyone is *entitled to* across all partners should
  add up to the same total as what was actually *collected*, minus the
  owner's share, once every payment and correction is accounted for.
- §7 stays a plain "cash in the door" number on purpose — it should never
  start trying to answer "was the right month's rent paid", because that's
  a different question with a different, more careful answer (§2).
