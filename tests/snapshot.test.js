// Regression tests for the monthly snapshot (the shareable canvas image
// built from Repo.monthlyPropertyBreakdown/monthlyStatusForAllTenants/etc).
// Exercises the real buildSnapshotData + drawSnapshotCanvas functions
// against synthetic data and checks both the underlying numbers and that
// the canvas actually renders something.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/harness");

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness.close(); });

test("buildSnapshotData reports collected/arrears/paidCount consistent with the underlying tenants", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prop = await Repo.addProperty({ name: "Snapshot Test" });

      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Paid Tenant", monthly_rent: 5000 });
      await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 5000, date: mk + "-05" });

      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Due Tenant", monthly_rent: 3000 });
      // no payment — stays Due

      const t3 = await Repo.addTenant({ property_id: prop.id, name: "Partial Tenant", monthly_rent: 4000 });
      await Repo.recordRentPayment({ tenant_id: t3.id, total_amount: 1500, date: mk + "-05" });

      const data = await buildSnapshotData(mk);
      const propRow = data.byProperty.find(p => p.property.id === prop.id);
      return { data: { collected: data.collected, totalTenants: data.totalTenants, paidCount: data.paidCount }, propRow };
    });
    assert.equal(result.data.paidCount, 1);
    assert.equal(result.data.totalTenants, 3);
    // data.collected is raw cash collected this month (Repo.totalCollectedForMonth), not
    // capped per-tenant — 5000 + 1500 = 6500.
    assert.equal(result.data.collected, 6500);
    assert.equal(result.propRow.paid, 1);
    assert.equal(result.propRow.partial, 1);
    assert.equal(result.propRow.due, 1);
    // propRow.collected is appliedToCurrentMonth-based (regression: must agree
    // with the paid/partial/due counts shown right next to it on the snapshot).
    assert.equal(result.propRow.collected, 5000 + 1500);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("buildSnapshotData's byProperty collected figure doesn't get inflated by a tenant paying off old arrears (regression)", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const startMk = addMonths(mk, -4);
      const prop = await Repo.addProperty({ name: "Arrears Snapshot Test" });
      const tenant = await Repo.addTenant({ property_id: prop.id, name: "Arrears Tenant", monthly_rent: 5000 });
      await Repo.updateTenant(tenant.id, { start_date: startMk + "-01", rent_history: [{ effective_month: startMk, rent: 5000 }], last_accrual_month: startMk });
      // Pays exactly this month's rent while 3 prior months (15000) are still unpaid.
      await Repo.recordRentPayment({ tenant_id: tenant.id, total_amount: 5000, date: mk + "-10" });

      const data = await buildSnapshotData(mk);
      const propRow = data.byProperty.find(p => p.property.id === prop.id);
      return propRow;
    });
    assert.equal(result.due, 1, "a tenant who only cleared old arrears should still show Due for this month");
    assert.equal(result.paid, 0);
    assert.equal(result.collected, 0, "nothing should count as collected toward this month if the payment went to old arrears first");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("drawSnapshotCanvas renders without throwing and produces a non-trivial image", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prop = await Repo.addProperty({ name: "Canvas Test" });
      const tenant = await Repo.addTenant({ property_id: prop.id, name: "T", monthly_rent: 5000 });
      await Repo.recordRentPayment({ tenant_id: tenant.id, total_amount: 5000, date: mk + "-05" });

      const data = await buildSnapshotData(mk);
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      await drawSnapshotCanvas(canvas, data);
      const dataUrl = canvas.toDataURL("image/png");
      return { width: canvas.width, height: canvas.height, dataUrlLength: dataUrl.length };
    });
    assert.ok(result.width > 0 && result.height > 0, "canvas should have real dimensions after drawing");
    // A blank canvas still produces a small non-empty PNG data URL; a real
    // rendered snapshot with text/shapes should be meaningfully larger.
    assert.ok(result.dataUrlLength > 5000, `expected a substantial rendered image, got ${result.dataUrlLength} chars`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
