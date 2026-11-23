#!/usr/bin/env node
// Checks the size of the BUILT extension (dist/) — what users actually install.
// Run after `npm run build`.

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const MAX_TOTAL_KB = 1024; // whole package
const MAX_SCRIPT_KB = 200; // any single JS/CSS bundle

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ path: path.relative(DIST, p), size: fs.statSync(p).size });
  }
})(DIST);

const kb = (n) => (n / 1024).toFixed(1);
const total = files.reduce((s, f) => s + f.size, 0);
let failed = false;

console.log(`Extension package: ${kb(total)} KB (limit ${MAX_TOTAL_KB} KB)`);
if (total > MAX_TOTAL_KB * 1024) {
  console.error('✗ Package exceeds the size limit');
  failed = true;
}

for (const f of files) {
  if (/\.(js|css)$/.test(f.path) && f.size > MAX_SCRIPT_KB * 1024) {
    console.error(`✗ ${f.path} is ${kb(f.size)} KB (limit ${MAX_SCRIPT_KB} KB)`);
    failed = true;
  }
}

console.log('\nLargest files:');
files
  .sort((a, b) => b.size - a.size)
  .slice(0, 8)
  .forEach((f) => console.log(`  ${kb(f.size).padStart(7)} KB  ${f.path}`));

process.exit(failed ? 1 : 0);
