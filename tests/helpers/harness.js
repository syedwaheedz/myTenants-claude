// Shared test fixture: serves the real repo-root static files (the same
// index.html GitHub Pages deploys) and drives them with a real Chromium
// tab. Tests call into the app's actual Repo/UI functions via
// page.evaluate rather than reimplementing app logic in the test files —
// that way a test failure means the shipped code is wrong, not that a
// parallel reimplementation drifted from it.
"use strict";
const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = path.join(ROOT, rel);
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// One browser + one static server per test FILE (call in a `before` hook),
// then a fresh isolated browser context — so a fresh, empty IndexedDB —
// per individual test (call harness.newPage() in each test).
async function createHarness() {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    async newPage() {
      const context = await browser.newContext();
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => pageErrors.push(String((err && err.message) || err)));
      await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
      return {
        page,
        errors: pageErrors,
        close: () => context.close(),
      };
    },
    async close() {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createHarness };
