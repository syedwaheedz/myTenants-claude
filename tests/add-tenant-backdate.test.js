// A tenant added with an earlier start month is charged from that month, and
// an optional amount already paid is recorded against that first month.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/harness");

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness.close(); });

test("addTenant with a past start_month accrues every month through today and records the paid amount", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const r = await page.evaluate(async () => {
      const mk = monthKey();
      const start = addMonths(mk, -2);
      const prop = await Repo.addProperty({ name: "Backdate" });
      const t = await Repo.addTenant({ property_id: prop.id, name: "Re-added", monthly_rent: 1000, start_month: start, paid_amount: 400 });
      const status = Repo.monthlyTenantStatusFromTxns(t, start, (await getAll("transactions")).filter(x => x.tenant_id === t.id));
      return { balance: t.current_balance, startDate: t.start_date, start, status };
    });
    assert.equal(r.balance, 3 * 1000 - 400);
    assert.equal(r.startDate, r.start + "-01");
    assert.ok(r.status, "start month has a status");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("addTenant without start_month behaves as before (charged current month only)", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const bal = await page.evaluate(async () => {
      const prop = await Repo.addProperty({ name: "Now" });
      return (await Repo.addTenant({ property_id: prop.id, name: "New", monthly_rent: 2500 })).current_balance;
    });
    assert.equal(bal, 2500);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
