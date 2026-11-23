#!/usr/bin/env node
// Renders the extension icon PNGs (16/32/48/128 + 640 for the store) from icons/icon.svg.
// usage: npm run icons:app   (needs Chrome for Testing: npm run e2e:install)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { resolveChrome } = require('../e2e/launch.js');

const ICONS = path.resolve(__dirname, '..', 'icons');
const SIZES = { 16: 'icon16.png', 32: 'icon32.png', 48: 'icon48.png', 128: 'icon128.png', 640: 'icon.png' };

(async () => {
  const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'));
  const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const browser = await chromium.launch({ executablePath: resolveChrome() });
  try {
    for (const [size, file] of Object.entries(SIZES)) {
      const page = await browser.newPage({ viewport: { width: Number(size), height: Number(size) } });
      await page.setContent(`<body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
      await page.screenshot({ path: path.join(ICONS, file), omitBackground: true });
      await page.close();
      console.log('wrote', `icons/${file}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
