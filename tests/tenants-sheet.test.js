// Tests for the Tenants sheet (the home screen): Repo.rentRoll's per-month
// figures, and the rendered spreadsheet's filters, search, totals, grouping,
// CSV export and the per-row "Pay" shortcut. Runs the real app code in a
// headless browser, same as the other suites.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/harness");

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness.close(); });

// Seeds two properties: Alice (paid in full, via a receiver), Bob (partial),
// Carol (nothing paid), and Dave — who started last month, never paid it, and
// this month pays exactly one month's rent, which must clear the OLD month
// first and leave this month still Due.
async function seed(page) {
  return page.evaluate(async () => {
    const mk = monthKey();
    const prevMk = addMonths(mk, -1);
    const p1 = await Repo.addProperty({ name: "Alpha Block" });
    const p2 = await Repo.addProperty({ name: "Beta Shops" });
    const ravi = await Repo.addReceiver({ name: "Ravi" });
    const alice = await Repo.addTenant({ property_id: p1.id, name: "Alice", monthly_rent: 5000 });
    const bob = await Repo.addTenant({ property_id: p1.id, name: "Bob", monthly_rent: 6000 });
    const carol = await Repo.addTenant({ property_id: p2.id, name: "Carol", monthly_rent: 4000 });
    const dave = await Repo.addTenant({ property_id: p2.id, name: "Dave", monthly_rent: 3000 });
    await Repo.updateTenant(dave.id, { start_date: prevMk + "-01", rent_history: [{ effective_month: prevMk, rent: 3000 }], last_accrual_month: prevMk, current_balance: 3000 });
    await Repo.accrueMonthlyRent(await get("tenants", dave.id));
    await Repo.recordRentPayment({ tenant_id: alice.id, total_amount: 5000, date: todayISO(), splits: [{ receiver_id: ravi.id, amount: 5000 }] });
    await Repo.recordRentPayment({ tenant_id: bob.id, total_amount: 2500, date: todayISO() });
    await Repo.recordRentPayment({ tenant_id: dave.id, total_amount: 3000, date: todayISO() });
    return { mk, ids: { p1: p1.id, p2: p2.id, alice: alice.id, bob: bob.id, carol: carol.id, dave: dave.id } };
  });
}

test("rentRoll: who paid how much, who's pending, and payment details per tenant", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const { mk } = await seed(page);
    const rows = await page.evaluate(async (mk) => {
      const roll = await Repo.rentRoll(mk);
      return Object.fromEntries(roll.map(r => [r.tenant.name, {
        status: r.status, due: r.due, paid: r.paid, pending: r.pending, oldDues: r.oldDues, totalOwed: r.totalOwed,
        payments: r.payments.map(p => ({ amount: p.amount, receivedBy: p.receivedBy })),
      }]));
    }, mk);

    assert.equal(rows.Alice.status, "paid");
    assert.equal(rows.Alice.pending, 0);
    assert.equal(rows.Alice.totalOwed, 0);
    assert.deepEqual(rows.Alice.payments, [{ amount: 5000, receivedBy: ["Ravi"] }], "a payment must carry who received it");

    assert.equal(rows.Bob.status, "partial");
    assert.equal(rows.Bob.paid, 2500);
    assert.equal(rows.Bob.pending, 3500);
    assert.equal(rows.Bob.totalOwed, 3500);
    assert.deepEqual(rows.Bob.payments, [{ amount: 2500, receivedBy: [] }]);

    assert.equal(rows.Carol.status, "due");
    assert.equal(rows.Carol.pending, 4000);
    assert.deepEqual(rows.Carol.payments, []);

    assert.equal(rows.Dave.status, "due", "a payment that only clears last month must leave this month pending");
    assert.equal(rows.Dave.oldDues, 3000);
    assert.equal(rows.Dave.paid, 3000);
    assert.equal(rows.Dave.pending, 3000);
    assert.equal(rows.Dave.totalOwed, 3000);

    // Total owed for the current month must equal each tenant's live balance.
    const balances = await page.evaluate(async () => Object.fromEntries((await getAll("tenants")).map(t => [t.name, t.current_balance])));
    for (const name of Object.keys(rows)) assert.equal(rows[name].totalOwed, Math.max(0, balances[name]), `${name}: total owed vs balance`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("rentRoll ignores voided payments and payments counted toward a different month", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const p = await Repo.addProperty({ name: "P" });
      const t = await Repo.addTenant({ property_id: p.id, name: "T", monthly_rent: 5000 });
      const v = await Repo.recordRentPayment({ tenant_id: t.id, total_amount: 5000, date: todayISO() });
      await Repo.voidTransaction(v.id);
      await Repo.recordRentPayment({ tenant_id: t.id, total_amount: 1000, date: todayISO(), for_month: addMonths(mk, -1) });
      const row = (await Repo.rentRoll(mk))[0];
      return { status: row.status, paid: row.paid, payments: row.payments.length };
    });
    assert.equal(result.status, "due");
    assert.equal(result.paid, 0);
    assert.equal(result.payments, 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Tenants sheet is the home screen and renders a grouped grid with correct totals", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    await seed(page);
    const result = await page.evaluate(async () => {
      State.tab = "tenants"; State.sheetFilter = "all"; State.sheetProperty = ""; State.sheetSearch = "";
      await Screens.tenants();
      const q = (sel) => [...document.querySelectorAll(sel)];
      return {
        activeTab: document.querySelector(".tab.active > span:last-child").textContent.trim(),
        wide: document.body.classList.contains("wide"),
        tenantRows: q(".sheet tbody tr.tap").map(tr => tr.querySelector(".tn").textContent),
        groups: q(".sheet tr.grp td.c-name").map(td => td.textContent.trim()),
        footer: q(".sheet tfoot td").map(td => td.textContent.trim()),
        chips: q(".fchip").map(b => b.textContent.replace(/\s+/g, " ").trim()),
        payLine: document.querySelector(".pay-line") && document.querySelector(".pay-line").textContent,
      };
    });
    assert.equal(result.activeTab, "Tenants");
    assert.ok(result.wide, "the sheet should use the wide layout");
    assert.deepEqual(result.tenantRows, ["Alice", "Bob", "Carol", "Dave"]);
    assert.equal(result.groups.length, 2, "with all properties shown, rows are grouped per property");
    assert.match(result.groups[0], /Alpha Block/);
    // Footer: name, status, Rent, Paid, Pending, Old dues, Total owed, …
    assert.match(result.footer[0], /Total · 4 tenants/);
    assert.equal(result.footer[2], "₹18,000");
    assert.equal(result.footer[3], "₹10,500");
    assert.equal(result.footer[4], "₹10,500");
    assert.equal(result.footer[5], "₹3,000");
    assert.equal(result.footer[6], "₹10,500");
    assert.deepEqual(result.chips, ["All 4", "Pending 3", "Paid 1"]);
    assert.match(result.payLine, /₹5,000/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Tenants sheet: Pending/Paid filters, search, property filter and sorting", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const { ids } = await seed(page);
    const result = await page.evaluate(async (ids) => {
      const names = () => [...document.querySelectorAll(".sheet tbody tr.tap .tn")].map(e => e.textContent);
      State.tab = "tenants"; State.sheetFilter = "all"; State.sheetProperty = ""; State.sheetSearch = "";
      await Screens.tenants();
      setSheetFilter("pending"); const pending = names();
      setSheetFilter("paid"); const paid = names();
      setSheetFilter("all");
      State.sheetSearch = "ravi"; renderTenantSheet(); const byReceiver = names();
      State.sheetSearch = "";
      setSheetSort("pending"); const byPendingDesc = names();
      setSheetSort("name");
      State.sheetProperty = ids.p2; await Screens.tenants();
      const onlyBeta = names();
      const grouped = document.querySelectorAll(".sheet tr.grp").length;
      return { pending, paid, byReceiver, byPendingDesc, onlyBeta, grouped };
    }, ids);
    assert.deepEqual(result.pending, ["Bob", "Carol", "Dave"]);
    assert.deepEqual(result.paid, ["Alice"]);
    assert.deepEqual(result.byReceiver, ["Alice"], "search should match who received the payment");
    // Sorted biggest pending first, within each property group.
    assert.deepEqual(result.byPendingDesc, ["Bob", "Alice", "Carol", "Dave"]);
    assert.deepEqual(result.onlyBeta, ["Carol", "Dave"]);
    assert.equal(result.grouped, 0, "a single property's sheet needs no group rows");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Tenants sheet: moved-out tenants are hidden unless toggled on", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const { ids } = await seed(page);
    const result = await page.evaluate(async (ids) => {
      await Repo.archiveTenant(ids.carol, true);
      const names = () => [...document.querySelectorAll(".sheet tbody tr.tap .tn")].map(e => e.textContent);
      State.tab = "tenants"; State.sheetFilter = "all"; State.sheetProperty = ""; State.sheetSearch = ""; State.sheetShowMovedOut = false;
      await Screens.tenants();
      const hidden = names();
      State.sheetShowMovedOut = true; renderTenantSheet();
      return { hidden, shown: names() };
    }, ids);
    assert.deepEqual(result.hidden, ["Alice", "Bob", "Dave"]);
    assert.deepEqual(result.shown, ["Alice", "Bob", "Carol", "Dave"]);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Tenants sheet: CSV export matches the visible rows", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    await seed(page);
    const csv = await page.evaluate(async () => {
      State.tab = "tenants"; State.sheetFilter = "pending"; State.sheetProperty = ""; State.sheetSearch = "";
      await Screens.tenants();
      let captured = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { captured = blob; return origCreate.call(URL, blob); };
      await exportTenantSheetCsv();
      URL.createObjectURL = origCreate;
      return captured.text();
    });
    const lines = csv.split("\r\n");
    assert.equal(lines[0], "Month,Property,Tenant,Status,Rent,Paid,Pending,Old dues,Total owed,Received by,Credited to pool,Payments");
    assert.equal(lines[1 + 3 + 1], "", "blank line, then the pool summary, after header + 3 pending tenants + total row");
    assert.match(lines[1], /,Alpha Block,Bob,partial,6000\.00,2500\.00,3500\.00,0\.00,3500\.00,,,/);
    assert.equal(lines[4], ",,Total,,13000.00,5500.00,10500.00,3000.00,10500.00,,,");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Tenants sheet: a row's Pay button opens Add payment on that month with the amount owed", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const { ids } = await seed(page);
    const result = await page.evaluate(async (ids) => {
      State.tab = "tenants"; State.sheetFilter = "all"; State.sheetProperty = ""; State.sheetSearch = "";
      await Screens.tenants();
      const bobRow = [...document.querySelectorAll(".sheet tbody tr.tap")].find(tr => tr.querySelector(".tn").textContent === "Bob");
      bobRow.querySelector(".cell-btn").click();
      await new Promise(r => setTimeout(r, 100));
      return {
        tenant: document.getElementById("ap-tenant").value,
        amount: document.getElementById("ap-amount").value,
        forMonth: document.getElementById("ap-for-month").value,
        stillOnSheet: State.tab,
        bob: ids.bob,
      };
    }, ids);
    assert.equal(result.tenant, result.bob);
    assert.equal(result.amount, "3500");
    assert.equal(result.forMonth, await page.evaluate(() => monthKey()));
    assert.equal(result.stillOnSheet, "tenants", "Pay must not also trigger the row's open-ledger click");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Tenants sheet and CSV show who received each payment and whose pool it was credited to", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const csv = await page.evaluate(async () => {
      const mk = monthKey();
      const partner = await Repo.addPartner({ name: "Ahmed", share_percent: 100 });
      const ravi = await Repo.addReceiver({ name: "Ravi", partner_id: partner.id });
      const loose = await Repo.addReceiver({ name: "Loose" });
      const prop = await Repo.addProperty({ name: "Pools" });
      const a = await Repo.addTenant({ property_id: prop.id, name: "Anil", monthly_rent: 1000 });
      const b = await Repo.addTenant({ property_id: prop.id, name: "Bina", monthly_rent: 2000 });
      await Repo.recordRentPayment({ tenant_id: a.id, total_amount: 1000, date: todayISO(), splits: [{ receiver_id: ravi.id, amount: 1000 }] });
      await Repo.recordRentPayment({ tenant_id: b.id, total_amount: 500, date: todayISO(), splits: [{ receiver_id: loose.id, amount: 500 }] });
      State.tab = "tenants"; State.sheetFilter = "all"; State.sheetProperty = ""; State.sheetSearch = "";
      await Screens.tenants();
      const strip = document.querySelector(".pool-strip")?.textContent || "";
      const line = [...document.querySelectorAll(".pay-line")].map(x => x.textContent);
      let captured = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => { captured = blob; return origCreate.call(URL, blob); };
      await exportTenantSheetCsv();
      URL.createObjectURL = origCreate;
      const totals = document.querySelector(".pool-totals")?.textContent || "";
      return { strip, line, totals, csv: await captured.text() };
    });
    assert.match(csv.strip, /Ahmed/);
    assert.match(csv.strip, /No pool/);
    assert.deepEqual(csv.line.slice(1, 3), ["Ravi", "Ahmed"], "separate Received by and Partner pool columns");
    assert.deepEqual(csv.line.slice(4, 6), ["Loose", "No pool"]);
    assert.match(csv.totals, /Partner pool totals/);
    assert.match(csv.totals, /Ahmed.*₹1,000/);
    assert.match(csv.totals, /No pool.*₹500/);
    assert.match(csv.totals, /Total received.*₹1,500/);
    assert.match(csv.csv, /Anil,paid,1000\.00,1000\.00,0\.00,0\.00,0\.00,Ravi,Ahmed,/);
    assert.match(csv.csv, /Bina,partial,.*,Loose,No pool,/);
    assert.match(csv.csv, /Pool summary,Credited by this sheet,Unsettled in pool now/);
    assert.match(csv.csv, /\r\nAhmed,1000\.00,1000\.00/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
