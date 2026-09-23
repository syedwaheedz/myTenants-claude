// Regression tests for the new "Rental Status Overview" screen: the
// Repo.arrearsBreakdownRows/arrearsAgingBuckets helpers, and the screen
// itself rendering real seeded data end-to-end via the Dashboard link.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/harness");

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness.close(); });

test("Repo.arrearsBreakdownRows sums accrued rent, adjustments and payments correctly, includes every tenant (even fully paid ones), and attaches a per-month Paid/Partial/Due breakdown", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prevMk = addMonths(mk, -1);
      const startMk = addMonths(mk, -2); // 3 months of accrual: startMk, prevMk, mk
      const prop = await Repo.addProperty({ name: "P" });

      // 3 months x 5000 = 15000 accrued, a -500 credit adjustment, a 4000 payment this month.
      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Arrears Tenant", monthly_rent: 5000 });
      await Repo.updateTenant(t1.id, { start_date: startMk + "-01", rent_history: [{ effective_month: startMk, rent: 5000 }], last_accrual_month: mk });
      await Repo.recordBalanceAdjustment({ tenant_id: t1.id, amount: -500, date: mk + "-01" });
      await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 4000, date: mk + "-05" });

      // Fully paid up — must still appear (with a zero balance), not be excluded.
      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Clean Tenant", monthly_rent: 3000 });
      await Repo.recordRentPayment({ tenant_id: t2.id, total_amount: 3000, date: mk + "-05" });

      const monthsRange = [prevMk, mk];
      const rows = await Repo.arrearsBreakdownRows(mk, monthsRange);
      return {
        rows: rows.map(r => ({
          name: r.tenant.name, totalRentOwed: r.totalRentOwed, totalPaid: r.totalPaid, balance: r.balance,
          monthlyPrev: r.monthly[prevMk] && r.monthly[prevMk].status,
          monthlyThis: r.monthly[mk] && r.monthly[mk].status,
        })),
      };
    });
    assert.equal(result.rows.length, 2, "every tenant must appear, including the fully-paid one");
    const arrearsRow = result.rows.find(r => r.name === "Arrears Tenant");
    assert.equal(arrearsRow.totalRentOwed, 14500, "15000 accrued - 500 credit adjustment");
    assert.equal(arrearsRow.totalPaid, 4000);
    assert.equal(arrearsRow.balance, 10500);
    assert.equal(arrearsRow.monthlyThis, "due", "the 4000 payment was needed to catch up on prior arrears, not cover this month");
    const cleanRow = result.rows.find(r => r.name === "Clean Tenant");
    assert.equal(cleanRow.balance, 0);
    assert.equal(cleanRow.monthlyThis, "paid");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Repo.arrearsAgingBuckets buckets each tenant by balance ÷ current monthly rent, and totals match arrearsBreakdownRows", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prop = await Repo.addProperty({ name: "P" });

      // Owes 0.5 months' rent (2000 / 4000) -> "0-1 mo" bucket.
      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Slightly Behind", monthly_rent: 4000 });
      await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 2000, date: mk + "-05" });

      // 3 months accrued (12000), paid 2000 -> balance 10000 = 2.5 months' rent -> "2-3 mo" bucket.
      const startMk = addMonths(mk, -2);
      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Well Behind", monthly_rent: 4000 });
      await Repo.updateTenant(t2.id, { start_date: startMk + "-01", rent_history: [{ effective_month: startMk, rent: 4000 }], last_accrual_month: mk });
      await Repo.recordRentPayment({ tenant_id: t2.id, total_amount: 2000, date: mk + "-05" });

      const buckets = await Repo.arrearsAgingBuckets(mk);
      const breakdown = await Repo.arrearsBreakdownRows(mk);
      return { buckets, totalFromBreakdown: breakdown.reduce((s, r) => s + r.balance, 0) };
    });
    const byLabel = Object.fromEntries(result.buckets.map(b => [b.label, b.value]));
    assert.equal(byLabel["0–1 mo"], 2000, "slightly-behind tenant's balance lands in the 0-1 month bucket");
    assert.equal(byLabel["2–3 mo"], 10000, "well-behind tenant's balance lands in the 2-3 month bucket");
    const totalBucketed = result.buckets.reduce((s, b) => s + b.value, 0);
    assert.equal(totalBucketed, result.totalFromBreakdown, "bucketed total must equal the sum of arrearsBreakdownRows balances");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Rental Status Overview screen renders from the Dashboard link with real data, and the back button returns", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prop = await Repo.addProperty({ name: "Overview Test Property" });
      const paidTenant = await Repo.addTenant({ property_id: prop.id, name: "Paid Tenant", monthly_rent: 4000 });
      await Repo.recordRentPayment({ tenant_id: paidTenant.id, total_amount: 4000, date: mk + "-05" });
      const dueTenant = await Repo.addTenant({ property_id: prop.id, name: "Due Tenant", monthly_rent: 3000 });

      goTab("dashboard");
      await new Promise(r => setTimeout(r, 50));
      const dashboardHasLink = !!document.querySelector(".list-row.tap[onclick*=\"goTab('rentalStatus')\"]");

      goTab("rentalStatus");
      await new Promise(r => setTimeout(r, 50));
      const root = document.getElementById("app");
      const svgCount = root.querySelectorAll("svg").length;
      const detailsEls = [...root.querySelectorAll("details.info-toggle")];
      const firstDetailsOpenBefore = detailsEls[0]?.open;
      detailsEls[0]?.querySelector("summary")?.click();
      const firstDetailsOpenAfter = detailsEls[0]?.open;

      const bodyText = root.innerText;

      // Back button returns to the dashboard.
      document.querySelector(".back-btn")?.click();
      await new Promise(r => setTimeout(r, 50));
      const backOnDashboard = document.getElementById("app").innerText.includes("Dashboard");

      return {
        dashboardHasLink, svgCount, detailsCount: detailsEls.length,
        firstDetailsOpenBefore, firstDetailsOpenAfter, bodyText, backOnDashboard,
      };
    });
    assert.equal(result.dashboardHasLink, true, "Dashboard must have the new 'Rental Status Overview' link row");
    assert.ok(result.svgCount >= 2, "donut + at least one bar chart should render as <svg>");
    assert.ok(result.detailsCount >= 4, "each chart/table section should have its own info-toggle");
    assert.equal(result.firstDetailsOpenBefore, false);
    assert.equal(result.firstDetailsOpenAfter, true, "clicking the summary should expand the details");
    assert.ok(result.bodyText.includes("Rental Status Overview"));
    assert.ok(result.bodyText.includes("Tenant payment ledger"));
    assert.ok(result.bodyText.includes("Arrears breakdown by tenant"));
    assert.ok(result.bodyText.includes("Paid Tenant"));
    assert.ok(result.bodyText.includes("Due Tenant"));
    assert.equal(result.backOnDashboard, true, "back button must return to the Dashboard");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
