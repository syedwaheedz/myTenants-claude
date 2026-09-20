// Copies the static web app into android_www/, the Capacitor webDir.
// Repo root stays untouched so GitHub Pages (jekyll-gh-pages.yml) keeps
// deploying index.html/manifest.json/icons exactly as before.
// sw.js is intentionally excluded: a service worker isn't needed inside a
// native WebView shell that has no separate "browser tab" to keep working
// offline in.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "android_www");

function copyFile(rel) {
  const src = path.join(root, rel);
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(rel) {
  const src = path.join(root, rel);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const relEntry = path.join(rel, entry.name);
    if (entry.isDirectory()) copyDir(relEntry);
    else copyFile(relEntry);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

copyFile("index.html");
copyFile("manifest.json");
copyDir("icons");

console.log(`Copied web assets into ${path.relative(root, out)}/`);
