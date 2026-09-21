// Copies the static web app into android_www/, the Capacitor webDir.
// Repo root stays untouched so GitHub Pages (jekyll-gh-pages.yml) keeps
// deploying index.html/manifest.json/icons exactly as before.
// sw.js is intentionally excluded: a service worker isn't needed inside a
// native WebView shell that has no separate "browser tab" to keep working
// offline in.
//
// Also injects the Capacitor core bridge into the copied index.html only.
// Capacitor 6 removed the old `bundledWebRuntime` option that used to do
// this automatically for non-bundler apps — without it, window.Capacitor
// is never defined inside the native app at all, silently breaking every
// isNativeApp()-gated code path (native file save/share, the native-app
// sign-in redirect, the App Links deep-link listener). The prebuilt
// standalone bundle bundledWebRuntime used to copy still ships inside the
// @capacitor/core package itself (dist/capacitor.js) — just needs to be
// copied and wired up by hand now instead of automatically.
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

// Capacitor core bridge — android_www only, never the repo-root index.html
// that GitHub Pages serves (there's no native bridge to connect to there).
const capacitorCoreSrc = path.join(root, "node_modules", "@capacitor", "core", "dist", "capacitor.js");
fs.copyFileSync(capacitorCoreSrc, path.join(out, "capacitor.js"));

const indexPath = path.join(out, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const bridgeTags = [
  '<script src="capacitor.js"></script>',
  '<script>window.Capacitor = window.capacitorExports && window.capacitorExports.Capacitor;</script>'
].join("\n");
if (!html.includes('<script src="capacitor.js">')) {
  html = html.replace("<head>", "<head>\n" + bridgeTags);
}
fs.writeFileSync(indexPath, html);

console.log(`Copied web assets into ${path.relative(root, out)}/ (with the Capacitor bridge wired in)`);
