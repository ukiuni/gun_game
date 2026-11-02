// Copies the files needed at runtime into _site/ (for GitHub Pages) and stamps the service-worker cache version.
// Usage: node tools/build-site.mjs [buildId]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const buildId = (process.argv[2] || process.env.GITHUB_SHA || `local-${Date.now()}`).slice(0, 12);

const entries = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'src', 'vendor', 'assets', 'icons'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const e of entries) fs.cpSync(path.join(root, e), path.join(out, e), { recursive: true });
fs.writeFileSync(path.join(out, '.nojekyll'), '');

const swPath = path.join(out, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes("const BUILD_ID = 'dev';")) throw new Error('BUILD_ID placeholder not found in sw.js');
fs.writeFileSync(swPath, sw.replace("const BUILD_ID = 'dev';", `const BUILD_ID = '${buildId}';`));

// sanity check: every file the service worker precaches exists in the output
const list = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
const missing = list.filter((f) => !fs.existsSync(path.join(out, f)));
if (missing.length) throw new Error(`missing files in _site: ${missing.join(', ')}`);
console.log(`_site built (BUILD_ID=${buildId}, ${list.length} precached files)`);
