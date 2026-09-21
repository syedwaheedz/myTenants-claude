// Regression tests for the Monthly Report (PDF) export and the JSON backup
// export/import. Exercises the real buildMonthlyReportData/
// buildMonthlyReportHtml/exportMonthlyReportPdf/exportDatabaseCopy/
// importDatabaseCopy functions.
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/harness");

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { await harness.close(); });

test("buildMonthlyReportData/Html shows 'Applied to this month', not raw payments, per tenant (regression)", async () => {
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

      const data = await buildMonthlyReportData(mk);
      const html = buildMonthlyReportHtml(data);
      const propDetail = data.propertyDetail.find(p => p.name === "Report Test Property");
      const row1 = propDetail.rows.find(r => r.tenant.id === t1.id);
      const row2 = propDetail.rows.find(r => r.tenant.id === t2.id);
      return { row1, row2, html };
    });
    assert.equal(result.row1.status, "due");
    assert.equal(result.row1.appliedToCurrentMonth, 0);
    assert.equal(result.row2.status, "paid");
    assert.equal(result.row2.appliedToCurrentMonth, 3000);
    assert.ok(result.html.includes("Applied to this month"), "report table header must reflect the oldest-debt-first figure, not raw payments");
    assert.ok(result.html.includes("Arrears Tenant"));
    assert.ok(result.html.includes("Clean Tenant"));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test("exportMonthlyReportPdf uses the native print plugin when isNativeApp() is true, and window.print otherwise", async () => {
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

      let webPrintCalled = false;
      window.print = () => { webPrintCalled = true; };
      await exportMonthlyReportPdf();
      await new Promise(r => setTimeout(r, 300));
      const webPrintCalledResult = webPrintCalled;

      let nativePrintArgs = null;
      window.Capacitor = { isNativePlatform: () => true, Plugins: { NativePrint: { print: (opts) => { nativePrintArgs = opts; } } } };
      webPrintCalled = false;
      await exportMonthlyReportPdf();
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

test("exportMonthlyReportPdf concatenates one 3-page report per month across a From/To range", async () => {
  const { page, errors, close } = await harness.newPage();
  try {
    const result = await page.evaluate(async () => {
      const toMk = monthKey();
      const fromMk = addMonths(toMk, -1);
      const prop = await Repo.addProperty({ name: "P" });
      await Repo.addTenant({ property_id: prop.id, name: "T", monthly_rent: 5000 });

      const fromInput = document.createElement("input");
      fromInput.id = "report-from-month";
      fromInput.value = fromMk;
      document.body.appendChild(fromInput);
      const toInput = document.createElement("input");
      toInput.id = "report-to-month";
      toInput.value = toMk;
      document.body.appendChild(toInput);

      window.print = () => {};
      await exportMonthlyReportPdf();
      await new Promise(r => setTimeout(r, 300));

      const root = document.getElementById("report-print-root");
      const pageCount = root.querySelectorAll(".r-page").length;
      const footerText = [...root.querySelectorAll(".r-footer")].map(f => f.textContent);
      return { pageCount, footerText, fromLabel: fmtMonth(fromMk), toLabel: fmtMonth(toMk) };
    });
    assert.equal(result.pageCount, 6, "2 months x 3 pages each");
    // Each month's footer is self-contained ("Page 1 of 3", not "Page 4 of 6")
    // but prefixed with its own month so it's clear which month you're looking at.
    assert.ok(result.footerText.some(t => t.includes("Page 1 of 3")));
    assert.ok(result.footerText.some(t => t.includes(result.fromLabel)), "footer should mention the From month");
    assert.ok(result.footerText.some(t => t.includes(result.toLabel)), "footer should mention the To month");
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
