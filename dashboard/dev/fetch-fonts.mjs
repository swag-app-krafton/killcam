#!/usr/bin/env node
/**
 * Self-hosts the Google Fonts that swagperf's frontend/index.html links, so the
 * Killcam dashboard renders identically with zero runtime network requests.
 *
 *   node dev/fetch-fonts.mjs <perfetto-monitor/frontend/index.html> <out dir>
 *
 * Keeps the latin and latin-ext subsets (latin-ext has ₹). Variable fonts that
 * Google serves as one file for several weights get one ranged @font-face.
 * Noto Sans KR (the Korean fallback) is skipped: Killcam shows no Korean text.
 */
import fs from 'node:fs';
import path from 'node:path';

const [indexHtml, outDir] = process.argv.slice(2);
if (!indexHtml || !outDir) {
  console.error('usage: fetch-fonts.mjs <index.html> <out dir>');
  process.exit(1);
}
const html = fs.readFileSync(indexHtml, 'utf8');
const href = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
if (!href) throw new Error('no fonts.googleapis.com stylesheet in ' + indexHtml);
// Drop families Killcam does not need.
const url = href.replace(/&family=Noto\+Sans\+KR[^&]*/, '');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const css = await (await fetch(url, { headers: { 'user-agent': UA } })).text();

const faces = [];
for (const m of css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face \{([\s\S]*?)\}/g)) {
  const [, subset, body] = m;
  if (subset !== 'latin' && subset !== 'latin-ext') continue;
  faces.push({
    subset,
    family: /font-family: '([^']+)'/.exec(body)[1],
    weight: Number(/font-weight: (\d+)/.exec(body)[1]),
    src: /url\((https:[^)]+)\)/.exec(body)[1],
    range: /unicode-range: ([^;]+);/.exec(body)[1],
  });
}
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.woff2')) fs.rmSync(path.join(outDir, f));

// Group by file: a variable font answers several weights from one URL.
const byFile = new Map();
for (const f of faces) {
  const g = byFile.get(f.src) ?? { ...f, weights: [] };
  g.weights.push(f.weight);
  byFile.set(f.src, g);
}
const blocks = [];
for (const g of byFile.values()) {
  const slug = g.family.toLowerCase().replace(/\s+/g, '-');
  const variable = g.weights.length > 1;
  const file = variable ? `${slug}-${g.subset}.woff2` : `${slug}-${g.weights[0]}-${g.subset}.woff2`;
  const buf = Buffer.from(await (await fetch(g.src)).arrayBuffer());
  fs.writeFileSync(path.join(outDir, file), buf);
  const weight = variable ? `${Math.min(...g.weights)} ${Math.max(...g.weights)}` : String(g.weights[0]);
  blocks.push(
    `/* ${g.subset} */\n@font-face {\n  font-family: '${g.family}';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('./${file}') format('woff2');\n  unicode-range: ${g.range};\n}\n`,
  );
}
const header = `/* Self-hosted copies of the fonts swagperf loads from Google Fonts, so Killcam makes
 * no external requests (the device may be offline). Latin and Latin Extended only
 * (Latin Extended carries ₹); Korean falls back to the system font. Both families
 * are SIL Open Font License 1.1: see OFL.txt. Refresh with scripts/sync-design-system.sh --fonts. */
`;
fs.writeFileSync(path.join(outDir, 'fonts.css'), header + '\n' + blocks.join('\n'));
console.log(`fonts: ${byFile.size} files, ${blocks.length} faces -> ${outDir}`);
