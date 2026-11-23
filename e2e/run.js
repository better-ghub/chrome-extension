#!/usr/bin/env node
// Runs the E2E specs against the built extension in dist/, in light and dark.
//
//   npm run e2e                  build, then every spec in both color schemes
//   node e2e/run.js pr-list      only specs whose name contains "pr-list"
//   node e2e/run.js --light      light scheme only
//   HEADED=1 node e2e/run.js     watch the browser
//
// The specs open live github.com pages (logged out) and replace
// api.github.com with a fake inside the extension's service worker, so no
// token is needed. Live pages change; a failure may be GitHub, not us.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SPECS = [
  { name: 'pr-page', schemes: ['light', 'dark'] },
  { name: 'pr-list', schemes: ['light', 'dark'] },
  { name: 'pages', schemes: ['light', 'dark'] },
  { name: 'multi-token', schemes: ['light'] },
  { name: 'review-tools', schemes: ['light', 'dark'] },
  { name: 'list-filters-and-inbox', schemes: ['light', 'dark'] },
  { name: 'diff-tools', schemes: ['light', 'dark'] },
];

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith('--'));
const onlyLight = args.includes('--light');
const dist = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/ is missing: run `npm run build` first (or `npm run e2e`).');
  process.exit(1);
}

const runs = [];
for (const spec of SPECS) {
  if (filters.length && !filters.some((f) => spec.name.includes(f))) continue;
  for (const scheme of onlyLight ? ['light'] : spec.schemes) runs.push({ spec: spec.name, scheme });
}

const summary = [];
for (const { spec, scheme } of runs) {
  console.log(`\n=== ${spec} (${scheme}) ===`);
  const argv = [path.join(__dirname, `${spec}.js`), dist, ...(scheme === 'dark' ? ['--dark'] : [])];
  const res = spawnSync(process.execPath, argv, { stdio: 'inherit', timeout: 5 * 60 * 1000 });
  summary.push({ spec, scheme, ok: res.status === 0 });
}

console.log('\n=== Summary ===');
for (const s of summary) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.spec} (${s.scheme})`);
const failed = summary.filter((s) => !s.ok).length;
console.log(`\n${summary.length - failed}/${summary.length} runs passed. Screenshots: e2e/shots/`);
process.exit(failed ? 1 : 0);
