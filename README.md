# myTenants — Web

A standalone, single-file web build of myTenants: same data model and
business rules as the Flutter mobile app (see `architecture-flow-design.md`),
implemented directly in HTML/CSS/JavaScript with the browser's IndexedDB
as local storage. No build step, no server, no login.

## Why this instead of a Flutter web build

Compiling the actual Flutter codebase to web output requires the Flutter
SDK and package downloads, neither of which were available in the sandbox
this was built in. This app is a from-scratch implementation of the same
schema and rules (§3–§6 of `architecture-flow-design.md`) in plain web
tech, which has a real advantage for your use case: GitHub Pages can serve
it with **zero build step** — just the static file, no Actions workflow
needed to compile it.

If you later get a working Flutter web build going (`flutter build web`),
you can swap this out for that output — same repo, same Pages setup.

## Deploying to GitHub Pages

1. Push `index.html`, `manifest.json`, `sw.js`, the `icons/` folder, and this
   README to a GitHub repo — either a new one, or a `web/` folder inside your
   existing `myTenants-claude` repo.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a
   branch."
4. Pick the branch (e.g. `main`) and the folder (`/root` if `index.html`
   is at the repo root, or `/web` if you put it in a subfolder — note
   GitHub Pages only offers `/root` or `/docs` as folder choices, so if
   you want a subfolder deploy, either rename it to `docs/` or use a
   dedicated branch/repo for the web build).
5. Save. GitHub gives you a URL like
   `https://<username>.github.io/<repo>/` within a minute or two.

No `.nojekyll` file is needed since there's nothing here for Jekyll to
misinterpret, but it doesn't hurt to add an empty one if you see odd
behavior with the underscore-prefixed nothing in this project (there
isn't any here, this is just a precaution some people add by habit).

## App icon & branding

The pink house/key/"myTenants" badge (`icons/icon-*.png` and
`icons/header-logo.png`) is your final logo — icon and wordmark baked
into one square, used as-is everywhere: the home screen icon, the
browser favicon, and the Dashboard header. It came in as a real PNG with
proper alpha transparency already, so it only needed a tight crop to its
true bounds (verified by compositing it over a contrasting color and
zooming into the edge pixels — clean, no halo).

`header-logo.png` is a higher-resolution copy of the same square, used
at 60px tall in the Dashboard header so the "myTenants" text baked into
the badge stays legible rather than shrinking away at icon size.

There are two flavors of each icon size: plain (`icon-192.png`,
`icon-512.png` — transparent corners) and `-maskable` (full-bleed pink
background, no transparency) — Android picks whichever one it needs
depending on the launcher's icon shape, so both need to stay in
`manifest.json`'s icon list. The app's own internal color scheme
(buttons, chips, charts) is unrelated and stays the muted teal it's
always been — only the icon and header branding use pink.

## Installing it as an app on Android (instead of a native APK)

There's no Android SDK or build toolchain involved — `manifest.json`,
`sw.js`, and the two icon files in `icons/` turn this into an installable
**Progressive Web App**, which is the simplest way to get something that
behaves like a real app on a phone without setting up Android Studio,
Gradle, or an app store listing:

1. Open the GitHub Pages URL in Chrome on Android.
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen** on
   older Chrome versions).
3. It installs with the teal "m" icon, opens full-screen with no browser
   address bar, and even keeps working with no signal (the app shell is
   cached; your actual data was always local to the browser anyway, per
   the section below).

To share it with someone else: just send them the link — there's nothing
to sideload, no "install from unknown sources" warning to click through,
and everyone always opens the same up-to-date version. iPhones get the
same result via Safari's **Share → Add to Home Screen**.

If you specifically need a literal installable `.apk` file (e.g. to send
over WhatsApp with no link, or list on an app store), the standard route
is Google's free [PWABuilder.com](https://www.pwabuilder.com) — paste in
the Pages URL and it packages this same manifest into a signed Android
package. That step needs to happen on a machine with internet access;
it's not something achievable in this sandbox (no Android SDK, and the
network here is locked down to a small allowlist that doesn't include
Google's package-signing services).

## Data & backup — read this before real use

- All data lives in **that browser's IndexedDB, on that device**. Clearing
  browser data/cache, using a different browser, or a different device
  means a different, empty database. This matches the tradeoff already
  called out in §1 of the architecture doc: the web copy and the mobile
  app's copy are two separate, unsynced stores.
- Use **Manage Partners → Export backup (.json)** regularly — it's the
  only backup mechanism, same as the mobile app's `exportDatabaseCopy`.
- **Manage Partners → Restore from backup** re-imports a `.json` export,
  replacing whatever is currently in this browser's storage.

## Look & feel

Restyled around Material Design 3: Roboto type, a teal seed palette (M3
tonal color roles — primary/on-primary/primary-container, surface,
outline, error/tertiary containers for status), elevated cards, a
Material-style bottom navigation bar with a pill indicator on the active
tab, an extended FAB for the primary action on each screen, bottom sheets
(complete with a drag handle) for forms and detail views, and Material
Symbols icons throughout. Everything is still organized as cards, per the
original brief.

Fonts and icons load from Google Fonts at runtime — fine for a GitHub
Pages–hosted site with normal internet access; if you ever need this to
work fully offline, swap those two `<link>` tags in `<head>` for
self-hosted copies.

## Dashboard visualizations

The dashboard, Defaulter List, Cash in Hand, and Manage Partners screens
now include small inline SVG charts (no external charting library — it's
about 40 lines of hand-rolled bar/donut chart code, so there's nothing to
version or break):

- **Collections trend** (Dashboard) — bar chart of rent collected per
  month, last 6 months
- **Arrears by property** (Dashboard) — donut chart of outstanding
  balances grouped by property
- **Top outstanding balances** (Defaulter List) — bar chart of the
  biggest tenant balances under the current filter
- **Split by receiver** (Cash in Hand) — donut chart of unsettled cash
  per receiver
- **Share of the pool** (Manage Partners) — donut chart of each partner's
  share %

These read from three new Repository methods — `monthlyCollections()`,
`arrearsByProperty()`, and `portfolioTotals()` — added alongside the
existing reporting methods; everything else in the data layer is
unchanged.

## How settlement actually reconciles the cash

Different partners end up physically holding different amounts of cash,
because different receivers collect from different tenants and report
into different partners' pools. Settlement isn't "split the pot" — it's
reconciling that imbalance so everyone ends up holding their fair share.

For each partner, the Settlement screen shows what they've actually
collected (via whichever receivers report to them, Arshad-style
collectors included) against what they're entitled to (their share % of
the period, plus anything still owed from before). The difference is
their **net position** — owed to them, or held in excess and owed out.

Below that, it works out the smallest set of **suggested transfers**
between partners that would even everyone out, and you can adjust the
amount on each one if only a partial transfer actually happened — whatever's
left over carries forward as that partner's balance into next period, same
as before.

Worked example: total collected ₹500, split 50/50. W1 collects ₹300
(₹250 directly + ₹50 via Arshad, who reports to W1); M2 collects ₹200.
Each is entitled to ₹250. W1 is holding ₹50 more than their share, M2 is
short ₹50 — so the suggested transfer is **W1 pays M2 ₹50**, and both
land exactly on their fair share once it's recorded.

Cash in Hand also now shows a **by partner pool** rollup above the
per-receiver breakdown, so you can see at a glance how much each partner
is actually holding right now, receivers included — not just the raw
per-receiver list.

## Recording who received the cash

Add Payment now has a **Received by** field right on the main form — pick
the receiver who actually collected it, and that's it. This is what feeds
Cash in Hand and Settlement: a receiver's collections roll up into
whichever partner's pool they're linked to (so, e.g., a non-partner
collector like Arshad who reports into a partner's pool shows up there,
not as a separate share). Leave it blank if you don't know yet — it's not
required, but you'll want it filled in before running a settlement so the
cash-in-hand breakdown is accurate.

If a single payment really was split between two people (rare, but it
happens), tap **Split between more than one person** to switch to the
multi-receiver entry instead — same as before, each row's amount must add
up to the total received.

## Recording a payment straight from Defaulters

Each tenant on the Defaulter List now has a **Record payment** button, so
catching up a late payer doesn't mean leaving the list to hunt for them
in the Add Payment dropdown. It opens the same Add Payment form with that
tenant already selected and the amount pre-filled with what they
currently owe (a full catch-up payment is one tap away, and the amount is
still fully editable for a partial one).

## Moving your data to a new version of this file

This was already possible (Manage Partners → the bottom "Backup" section)
but easy to miss — it's now labeled clearly for this exact purpose, and
picking a file to restore shows a preview (export date, and counts of
properties/tenants/transactions/partners) before the destructive confirm,
so you can check it's the right file first. Whenever you update
`index.html` to a newer version, export a backup from the old copy first,
then import it once the new one is open — the same steps work for
switching browsers or devices, since the data never travels with the
HTML file itself.

## Cash in hand now shows which property it's from

Each receiver's card in Cash in Hand breaks its unsettled total down by
property (e.g. "KNR: ₹500 · ZNS Complex: ₹300") — useful once a receiver
collects across more than one property, so you can tell where a
receiver's cash actually came from without having to check each payment
individually.

## Admin cleanup: fully removing test/typo data

There's no login or role system in this app — whoever has the file has
full access — so the normal safeguards (can't delete a tenant with
payment history, void instead of delete a transaction) are there to
protect real operational data from an accidental tap, not to lock
anyone out. While you're still setting things up and cleaning out test
entries, two admin-only escape hatches are available, both gated behind
a confirmation that spells out exactly what will be lost:

- **Force delete anyway (admin)** — appears in Edit Tenant only once a
  normal delete has been blocked. Deletes the tenant *and* every one of
  their transactions, splits, and audit-log entries — no trace left.
- **Delete permanently (admin)** — in any payment or adjustment's detail
  view, alongside Void. Unlike Void (which keeps the record and reverses
  its effect, for traceability), this removes the transaction and its
  audit entries entirely, after first reversing its balance effect if it
  hadn't been voided already.

Reach for **Void** and **Mark as moved out** for anything that's a real
correction to real data — those two admin actions are specifically for
data that shouldn't have existed in the first place.

## Changing a tenant's rent — two different operations, on purpose

Rent isn't a single number anymore internally — it's a small history of
`{effective month, rate}` entries, because a typo fix and a genuine
increase need to behave completely differently, and conflating them was
the source of a real bug: correcting a mistyped rent (e.g. 13,000 instead
of 12,000) only changed the field going forward, leaving the
already-accrued month still overcharged by the difference — which is
exactly why a corrected tenant could still show a small stray balance in
Defaulters. From the tenant's ledger → **Edit tenant** → **Change rent**:

- **Fix a mistake** — corrects the *current* rate in place and
  retroactively adjusts the balance for every month already accrued at
  the wrong amount, logged as an auditable adjustment with the exact
  correction spelled out (e.g. "Rent corrected: ₹13,000 → ₹12,000/mo (1
  month already charged, retroactively fixed)"). A live preview shows the
  adjustment amount before you save.
- **Record an increase** — for a genuine change (a yearly hike, say).
  Past months are left untouched — they were correct at the rate that
  applied then — this only schedules a new rate starting from a month you
  choose (the earliest option is always the next month that hasn't been
  accrued yet). The tenant's displayed rent doesn't change until that
  month actually arrives.

This is also why the ledger, the monthly Paid/Partial/Due view, and the
snapshot's historical arrears figure all now look up the rate that
actually applied to each specific month, rather than assuming today's
rate applied retroactively — a rent change (either kind) no longer
silently reshapes how past months are displayed.

## Monthly dashboard snapshot

Tap the camera icon next to "Dashboard" to open **Monthly snapshot**. Pick
a month and it renders a shareable portrait image — Collected that month,
Arrears *as of that month's end* (recomputed from the full transaction
history for that cutoff, not today's rolling balance, so a snapshot of a
past month is historically accurate), Cash in hand, tenants paid, and a
per-property paid/partial/due breakdown. **Download PNG** saves it;
**Share image** appears too on devices with a native share sheet (handy
for sending straight to a partner over WhatsApp). It's drawn on a plain
`<canvas>` rather than captured from the live page, so it's reliably crisp
regardless of font loading or screen size.

## Monthly view per property

On a property's tenant list, a small **Overall / This month** toggle
switches between the usual running-balance chip and a specific month's
collection status: **Paid**, **Partial**, or **Due**, with a quick summary
count above the list. The rule, to keep it unambiguous: a month is Paid if
payments *dated in that month* add up to at least one month's rent,
Partial if something but less, Due if nothing. This deliberately answers
"did we collect this month" rather than doing a strict oldest-debt-first
allocation — an advance payment counts toward the month it's recorded in,
not a future one. The overall running balance (used by Defaulters and the
ledger) is unaffected and remains the accurate oldest-debt-first figure.
Archived (moved-out) tenants still show for months they were active,
tagged "(moved out)".

## Fixing a mistake in a payment or adjustment

Open the payment from the Dashboard's recent activity or the tenant's
ledger and tap **Edit this payment** (or **Edit this adjustment**). It
reverses the entry's old effect on the tenant's balance and applies the
corrected one, replaces any splits, and writes an EDIT entry to the audit
log alongside it — the same traceability the mobile app's spec calls for,
just without making you void and re-enter the whole thing.

One guard rail: once any of a payment's splits have been marked settled
in a partner settlement, editing is turned off for that payment (you'll
see why in its detail view) — voiding it is the right move there instead,
since the cash has already been counted in a partner's payout.

## Bringing in pending dues from before this app

Open a tenant's ledger and tap **Adjust balance / add pending due**. Enter
a positive amount (e.g. their real-world outstanding balance from a paper
ledger or an earlier system) and it's added to what they owe — logged as
its own line in their ledger, auditable and voidable like any other entry,
so it never causes their balance and their ledger to drift apart the way a
silent field edit would. A negative amount works the other way, e.g. for a
goodwill credit.

Worked example: tenant owes ₹29,000 from before. Record that as a +₹29,000
adjustment, then a ₹15,000 payment the normal way — balance is ₹14,000.
Next month's rent (say ₹6,500) accrues on top automatically as usual, for
₹20,500 — no special handling needed once the opening figure is in.

## What's implemented

Matches §5 of the architecture doc:

- **Partners** — add/edit/remove, share % validation (warns if shares
  don't sum to 100%)
- **Receivers** — a small fixed set of people, each optionally linked to
  a partner's pool (this is how a non-partner collector's cash rolls up
  into a partner's share)
- **Tenants & accrual** — rent accrues automatically per elapsed calendar
  month on load; the Tenant Ledger screen reconstructs Due/Paid history
  without a stored row per unpaid month
- **Transactions** — record a rent payment with an optional repair
  deduction (credits the tenant's balance without counting as cash
  collected) and an optional receipt photo; split a payment across
  receivers (must sum to the amount received); void a transaction
  (reverses its balance effect and writes an audit-log entry)
- **Settlement** — pick a period, see collected cash minus fixed owner
  rent, split by each partner's share % plus their carried opening
  balance, edit the amount actually paid out, and record it (marks the
  underlying splits settled and updates each partner's running balance)
- **Properties & Tenants (CRUD)** — with the same delete guards as the
  mobile app (can't delete a property with tenants, or a tenant with
  transaction history)
- **Reporting** — Dashboard (arrears, this month's collections, recent
  activity), Defaulter List (filterable by property), Cash in Hand (by
  receiver, showing which partner's pool it feeds)
- **Audit log** — every void is logged and viewable from a transaction's
  detail view

## Known differences from the mobile app / simplifications

- Multi-month lump-sum payments are recorded as a single amount against
  the tenant's balance rather than an explicit month-range picker; the
  Tenant Ledger still reconstructs oldest-month-first Due rows correctly
  against whatever balance results, since the balance model is a single
  rolling number either way.
- A negative "amount received" is how an advance return / refund is
  recorded (increases the tenant's balance) — there's no separate
  transaction type for it, matching the decision to keep types to
  RENT_PAYMENT / REPAIR / OWNER_PAYOUT.
- A brand-new tenant now owes their move-in month's rent immediately
  instead of waiting for the next calendar month's accrual pass — this
  also self-heals any tenant already sitting at a stuck ₹0 balance in
  data created before this fix, the next time the app loads (it only
  ever adds a first month's rent to a tenant with zero balance **and**
  zero transactions, so a tenant who's genuinely paid in full is never
  affected).
- Deleting a tenant is still blocked once they have any recorded payment
  (same data-integrity rule as the mobile app), but now says so clearly
  inline in the Edit Tenant sheet instead of relying only on a toast.
  The practical fix for "this tenant moved out" is the new **Moved out**
  toggle on that same sheet — it hides them from the property's active
  tenant list (they show in a separate "Moved out" section instead) while
  keeping every past payment and any balance they still owe fully intact.
  Hard delete remains available, and still only works for a tenant with
  zero transaction history.
- OWNER_PAYOUT as its own logged transaction type isn't in this build;
  owner rent is subtracted as each property's fixed monthly amount during
  settlement, per §6.3. Worth adding if you want owner payouts individually
  logged and auditable too.
- Receipt photos are stored as base64 inside IndexedDB (no external file
  system on the web), which is fine for a handful of images but will bloat
  export files if used heavily.
