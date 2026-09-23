// Regression tests for the unified export report (Tenant rental status /
// Partner settlement status / Full view) and the JSON backup export/import.
// Exercises the real buildExportReportData/buildTenantStatusReportHtml/
// buildPartnerSettlementReportHtml/buildFullViewReportHtml/exportReportPdf/
// exportDatabaseCopy/importDatabaseCopy functions.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/harness");

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness.close(); });

test("Tenant rental status report shows 'Applied to this month', not raw payments, per tenant (regression)", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const startMk = addMonths(mk, -3);
      const prop = await Repo.addProperty({ name: "Report Test Property" });

      // Arrears tenant: pays this month's rent, but it's consumed by 2 prior
      // unpaid months first — report must show 0 applied / still Due, not
      // the raw 5000 paid / Paid.
      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Arrears Tenant", monthly_rent: 5000 });
      await Repo.updateTenant(t1.id, { start_date: startMk + "-01", rent_history: [{ effective_month: startMk, rent: 5000 }], last_accrual_month: startMk });
      await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 5000, date: mk + "-10" });

      // Clean tenant: pays this month in full, no history.
      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Clean Tenant", monthly_rent: 3000 });
      await Repo.recordRentPayment({ tenant_id: t2.id, total_amount: 3000, date: mk + "-05" });

      const statusRows = await Repo.tenantStatusRows(mk);
      const row1 = statusRows.find(r => r.tenant.id === t1.id);
      const row2 = statusRows.find(r => r.tenant.id === t2.id);

      const data = await buildExportReportData(mk, mk);
      const html = buildTenantStatusReportHtml(data);
      return { row1, row2, html };
    });
    assert.equal(result.row1.status, "due");
    assert.equal(result.row1.appliedToCurrentMonth, 0);
    assert.equal(result.row2.status, "paid");
    assert.equal(result.row2.appliedToCurrentMonth, 3000);
    assert.ok(result.html.includes("Applied this month"), "report table header must reflect the oldest-debt-first figure, not raw payments");
    assert.ok(result.html.includes("Arrears Tenant"));
    assert.ok(result.html.includes("Clean Tenant"));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Report 1 (Tenant rental status) and Report 2 (Partner settlement status) both list every payment for tallying against manual/receipt records", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const partnerA = await Repo.addPartner({ name: "Alice", share_percent: 50 });
      const partnerB = await Repo.addPartner({ name: "Bob", share_percent: 50 });
      const recvA = await Repo.addReceiver({ name: "Alice Receiver", partner_id: partnerA.id });
      const recvB = await Repo.addReceiver({ name: "Bob Receiver", partner_id: partnerB.id });
      const prop = await Repo.addProperty({ name: "Payments Test Property" });
      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Tenant One", monthly_rent: 5000 });
      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Tenant Two", monthly_rent: 3000 });

      await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 5000, date: mk + "-05", splits: [{ receiver_id: recvA.id, amount: 5000 }] });
      await Repo.recordRentPayment({ tenant_id: t2.id, total_amount: 3000, date: mk + "-10", splits: [{ receiver_id: recvB.id, amount: 3000 }] });

      const rows = await Repo.paymentsReceivedInRange(mk, mk);

      const data = await buildExportReportData(mk, mk);
      const tenantHtml = buildTenantStatusReportHtml(data);
      const settlementHtml = buildPartnerSettlementReportHtml(data);

      return { rows, tenantHtml, settlementHtml };
    });
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].total_amount, 5000, "sorted oldest-first by date");
    assert.equal(result.rows[1].total_amount, 3000);
    assert.ok(result.rows[0].receivedByNames.join(",").includes("Alice Receiver"));
    assert.ok(result.rows[1].receivedByNames.join(",").includes("Bob Receiver"));

    assert.ok(result.tenantHtml.includes("Full transaction history"));
    assert.ok(result.tenantHtml.includes("Tenant One"));
    assert.ok(result.tenantHtml.includes("Tenant Two"));
    assert.ok(result.tenantHtml.includes("Alice Receiver"));

    assert.ok(result.settlementHtml.includes("Payments received this period"));
    assert.ok(result.settlementHtml.includes("Tenant One"));
    assert.ok(result.settlementHtml.includes("Bob Receiver"));

    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Report 1's Arrears breakdown by tenant includes every tenant (paid and unpaid) with one column per month in the export range", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const toMk = monthKey();
      const fromMk = addMonths(toMk, -1);
      const prop = await Repo.addProperty({ name: "Arrears Export Property" });

      // In arrears: 2 months accrued (5000 x 2 = 10000), paid 3000.
      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Behind Tenant", monthly_rent: 5000 });
      await Repo.updateTenant(t1.id, { start_date: fromMk + "-01", rent_history: [{ effective_month: fromMk, rent: 5000 }], last_accrual_month: toMk });
      await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 3000, date: fromMk + "-05" });

      // Fully paid up both months — must still appear.
      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Current Tenant", monthly_rent: 4000 });
      await Repo.updateTenant(t2.id, { start_date: fromMk + "-01", rent_history: [{ effective_month: fromMk, rent: 4000 }], last_accrual_month: toMk });
      await Repo.recordRentPayment({ tenant_id: t2.id, total_amount: 4000, date: fromMk + "-05" });
      await Repo.recordRentPayment({ tenant_id: t2.id, total_amount: 4000, date: toMk + "-05" });

      const data = await buildExportReportData(fromMk, toMk);
      const html = buildTenantStatusReportHtml(data);
      return { html, monthsInRange: data.monthsInRange, arrearsRows: data.arrearsRows.map(r => ({ name: r.tenant.name, balance: r.balance })) };
    });
    assert.equal(result.monthsInRange.length, 2, "one column per month in the From/To range");
    assert.ok(result.html.includes("Arrears breakdown by tenant"));
    assert.ok(result.html.includes("Behind Tenant"));
    assert.ok(result.html.includes("Current Tenant"), "fully-paid tenants must still appear, not be filtered out");
    assert.equal(result.arrearsRows.find(r => r.name === "Behind Tenant").balance, 7000, "10000 accrued - 3000 paid");
    assert.equal(result.arrearsRows.find(r => r.name === "Current Tenant").balance, 0);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Full view report is exactly 2 pages — page 1 tenant status + full transactions, page 2 partner settlement", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const partner = await Repo.addPartner({ name: "Alice", share_percent: 100 });
      const recv = await Repo.addReceiver({ name: "Alice Receiver", partner_id: partner.id });
      const prop = await Repo.addProperty({ name: "Full View Property" });
      const t = await Repo.addTenant({ property_id: prop.id, name: "Full View Tenant", monthly_rent: 4000 });
      await Repo.recordRentPayment({ tenant_id: t.id, total_amount: 4000, date: mk + "-05", splits: [{ receiver_id: recv.id, amount: 4000 }] });

      const data = await buildExportReportData(mk, mk);
      const html = buildFullViewReportHtml(data);
      const root = document.createElement("div");
      root.innerHTML = html;
      const pageCount = root.querySelectorAll(".r-page").length;
      const footerText = [...root.querySelectorAll(".r-footer")].map(f => f.textContent);
      return { html, pageCount, footerText };
    });
    assert.equal(result.pageCount, 2);
    assert.ok(result.footerText.some(t => t.includes("Page 1 of 2")));
    assert.ok(result.footerText.some(t => t.includes("Page 2 of 2")));
    assert.ok(result.html.includes("Tenant Rental Status"));
    assert.ok(result.html.includes("Partner Settlement Status"));
    assert.ok(result.html.includes("Full transaction history"));
    assert.ok(result.html.includes("Suggested transfers"));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("Repo.transactionsInRange keeps every type (including adjustments and voided rows), sorted tenant-then-date", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prop = await Repo.addProperty({ name: "P" });
      const t1 = await Repo.addTenant({ property_id: prop.id, name: "Zed Tenant", monthly_rent: 5000 });
      const t2 = await Repo.addTenant({ property_id: prop.id, name: "Amy Tenant", monthly_rent: 3000 });

      const payment = await Repo.recordRentPayment({ tenant_id: t1.id, total_amount: 5000, date: mk + "-05" });
      await Repo.recordBalanceAdjustment({ tenant_id: t2.id, amount: -500, date: mk + "-06", note: "Discount" });
      await Repo.voidTransaction(payment.id);

      const rows = await Repo.transactionsInRange(mk, mk);
      // paymentsReceivedInRange must still exclude the voided payment and
      // any non-RENT_PAYMENT rows — unchanged behavior after the refactor.
      const paymentsOnly = await Repo.paymentsReceivedInRange(mk, mk);
      return { rows: rows.map(r => ({ tenant: r.tenant?.name, type: r.type, voided: r.is_voided })), paymentsOnlyCount: paymentsOnly.length };
    });
    assert.equal(result.rows.length, 2, "both the voided payment and the adjustment are kept");
    assert.equal(result.rows[0].tenant, "Amy Tenant", "sorted by tenant name first");
    assert.equal(result.rows[1].tenant, "Zed Tenant");
    assert.ok(result.rows.some(r => r.type === "ADJUSTMENT"));
    assert.ok(result.rows.some(r => r.type === "RENT_PAYMENT" && r.voided === true));
    assert.equal(result.paymentsOnlyCount, 0, "the voided payment must not appear in paymentsReceivedInRange");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("exportReportPdf uses the native print plugin when isNativeApp() is true, and window.print otherwise", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const mk = monthKey();
      const prop = await Repo.addProperty({ name: "P" });
      await Repo.addTenant({ property_id: prop.id, name: "T", monthly_rent: 5000 });

      const fromInput = document.createElement("input");
      fromInput.id = "report-from-month";
      fromInput.value = mk;
      document.body.appendChild(fromInput);
      const toInput = document.createElement("input");
      toInput.id = "report-to-month";
      toInput.value = mk;
      document.body.appendChild(toInput);
      State.exportMode = "tenant";

      let webPrintCalled = false;
      window.print = () => { webPrintCalled = true; };
      await exportReportPdf();
      await new Promise(r => setTimeout(r, 300));
      const webPrintCalledResult = webPrintCalled;

      let nativePrintArgs = null;
      window.Capacitor = { isNativePlatform: () => true, Plugins: { NativePrint: { print: (opts) => { nativePrintArgs = opts; } } } };
      webPrintCalled = false;
      await exportReportPdf();
      await new Promise(r => setTimeout(r, 300));

      return { webPrintCalled: webPrintCalledResult, nativePrintCalledWebPrintToo: webPrintCalled, nativePrintArgs, reportHtmlNonEmpty: document.getElementById("report-print-root").innerHTML.length > 0 };
    });
    assert.equal(result.webPrintCalled, true, "the web path should call window.print()");
    assert.ok(result.nativePrintArgs, "the native path should call the NativePrint plugin instead of window.print() (which is a silent no-op in Android WebView)");
    assert.equal(result.nativePrintCalledWebPrintToo, false, "the native path must not also fall through to window.print()");
    assert.match(result.nativePrintArgs.jobName, /^myTenants-/);
    assert.equal(result.reportHtmlNonEmpty, true);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("A multi-month From/To range produces one cohesive report, not one concatenated per month", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const toMk = monthKey();
      const fromMk = addMonths(toMk, -1);
      const prop = await Repo.addProperty({ name: "P" });
      const t = await Repo.addTenant({ property_id: prop.id, name: "T", monthly_rent: 5000 });
      await Repo.recordRentPayment({ tenant_id: t.id, total_amount: 5000, date: fromMk + "-05" });
      await Repo.recordRentPayment({ tenant_id: t.id, total_amount: 5000, date: toMk + "-05" });

      const data = await buildExportReportData(fromMk, toMk);
      const html = buildTenantStatusReportHtml(data);
      const root = document.createElement("div");
      root.innerHTML = html;
      const pageCount = root.querySelectorAll(".r-page").length;
      const footerText = [...root.querySelectorAll(".r-footer")].map(f => f.textContent);
      // Both months' payments should appear in the one full-transaction table.
      const rowCount = root.querySelectorAll("table tr").length;
      return { pageCount, footerText, txRowCount: data.txRows.length };
    });
    assert.equal(result.pageCount, 1, "a 2-month range is still a single report, not one page per month");
    assert.ok(result.footerText.some(t => t.includes("Page 1 of 1")));
    assert.equal(result.txRowCount, 2, "the full transaction table spans the whole range");
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("exportDatabaseCopy / importDatabaseCopy round-trip preserves all data", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const prop = await Repo.addProperty({ name: "Backup Test" });
      const tenant = await Repo.addTenant({ property_id: prop.id, name: "T", monthly_rent: 5000 });
      await Repo.recordRentPayment({ tenant_id: tenant.id, total_amount: 2000, date: todayISO() });

      // Capture what exportDatabaseCopy would write, without needing to
      // intercept the anchor-click download (same STORES dump it builds).
      const dump = {};
      for (const s of STORES) dump[s] = await getAll(s);
      const dumpJson = JSON.stringify(dump);

      // Wipe everything, then restore from the captured dump.
      for (const s of STORES) await tx(s, "readwrite", store => store.clear());
      const propertiesAfterWipe = await getAll("properties");

      await Repo.importDatabaseCopy(dumpJson);
      const propertiesAfterRestore = await getAll("properties");
      const tenantsAfterRestore = await getAll("tenants");
      const txnsAfterRestore = await getAll("transactions");
      const restoredTenant = tenantsAfterRestore.find(t => t.id === tenant.id);

      return { propertiesAfterWipe, propertiesAfterRestore, tenantsAfterRestore, txnsAfterRestore, restoredTenant };
    });
    assert.equal(result.propertiesAfterWipe.length, 0);
    assert.equal(result.propertiesAfterRestore.length, 1);
    assert.equal(result.propertiesAfterRestore[0].name, "Backup Test");
    assert.equal(result.tenantsAfterRestore.length, 1);
    assert.equal(result.restoredTenant.current_balance, 3000); // 5000 accrued - 2000 paid
    assert.equal(result.txnsAfterRestore.length, 1);
    assert.equal(result.txnsAfterRestore[0].total_amount, 2000);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
