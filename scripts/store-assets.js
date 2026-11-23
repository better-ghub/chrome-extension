#!/usr/bin/env node
// Renders Chrome Web Store assets (screenshots, promo tiles) into store/.
// Uses the real e2e screenshots from e2e/shots/ and icons/icon.svg; no network access.
// Usage: npm run store:assets
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { resolveChrome } = require('../e2e/launch.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'e2e/shots');
const OUT = path.join(ROOT, 'store');

const dataUrl = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
// Screenshots per UI language: e2e/shots/<lang>/ (E2E_LANG=<lang> npm run e2e), else e2e/shots/.
let LANG = 'en';
const shotFile = (name) => {
  const localized = path.join(SHOTS, LANG, `${name}.png`);
  return fs.existsSync(localized) ? localized : path.join(SHOTS, `${name}.png`);
};
const png = (name) => dataUrl(shotFile(name), 'image/png');
const iconUrl = dataUrl(path.join(ROOT, 'icons/icon.svg'), 'image/svg+xml');

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const THEMES = {
  dark: { bg: 'linear-gradient(160deg,#0d1117 0%,#161b22 100%)', fg: '#f0f6fc', sub: '#9da7b3', border: 'rgba(240,246,252,.18)' },
  light: { bg: 'linear-gradient(160deg,#f6f8fa 0%,#e6ebf1 100%)', fg: '#1f2328', sub: '#59636e', border: 'rgba(31,35,40,.15)' },
  tint: { bg: 'linear-gradient(160deg,#f3f0ff 0%,#e3ecfb 100%)', fg: '#1f2328', sub: '#59636e', border: 'rgba(31,35,40,.15)' },
};

// crop = [x, y, w, h] in source pixels
const SCREENSHOTS = [
  {
    file: '01-pull-request-list',
    theme: 'dark',
    items: [{ img: 'w2-list-filtered', crop: [40, 185, 1270, 715] }],
    en: ['See what matters in every PR list', 'Size, review state, unresolved threads and conflicts, plus ready and stale chips with one-click filters.'],
    pl: ['Zobacz, co ważne, na liście PR-ów', 'Rozmiar, stan recenzji, nierozwiązane wątki i konflikty oraz chipy i filtry jednym kliknięciem.'],
  },
  {
    file: '02-popup-inbox',
    theme: 'light',
    items: [
      { img: 'popup-inbox-dark', crop: [0, 0, 380, 600] },
      { img: 'w2-popup-snoozed', crop: [0, 0, 380, 600] },
    ],
    en: ['Your PR inbox in the toolbar', 'Review requests, your PRs and an unread badge, with snooze, pin and quiet hours.'],
    pl: ['Skrzynka PR-ów w pasku narzędzi', 'Prośby o recenzję, Twoje PR-y i licznik nieprzeczytanych, z drzemką, przypinaniem i godzinami ciszy.'],
  },
  {
    file: '03-file-finder',
    theme: 'tint',
    items: [{ img: 'finder-dark', crop: [0, 65, 1360, 665] }],
    en: ['Find any changed file instantly', 'File finder, generated-file collapse and diff toggles keep large reviews fast.'],
    pl: ['Znajdź zmieniony plik w sekundę', 'Wyszukiwarka plików, zwijanie wygenerowanych plików i przełączniki diffa przyspieszają duże recenzje.'],
  },
  {
    file: '04-keyboard-shortcuts',
    theme: 'dark',
    items: [{ img: 'w1-cheatsheet', crop: [321, 73, 718, 663] }],
    en: ['Review with the keyboard', 'Jump between unresolved threads, collapse files, copy the branch or a link. Every shortcut is remappable.'],
    pl: ['Recenzuj z klawiatury', 'Skacz po nierozwiązanych wątkach, zwijaj pliki, kopiuj gałąź lub link. Każdy skrót możesz zmienić.'],
  },
  {
    file: '05-multi-token',
    theme: 'light',
    items: [{ img: 'mt-two-tokens', crop: [425, 225, 745, 595] }],
    en: ['One token per organization', 'Add a read-only token for each org and the right one is picked automatically. Tokens stay in your browser.'],
    pl: ['Jeden token na organizację', 'Dodaj token tylko do odczytu dla każdej organizacji, a właściwy wybierze się sam. Tokeny zostają w przeglądarce.'],
  },
];

const SIZE_CACHE = {};
function sizeOf(name) {
  const key = `${LANG}:${name}`;
  if (!SIZE_CACHE[key]) {
    const b = fs.readFileSync(shotFile(name));
    SIZE_CACHE[key] = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  return SIZE_CACHE[key];
}

// A cropped, rounded, shadowed screenshot scaled by s.
function shotHtml(item, s, th) {
  const [x, y, w, h] = item.crop;
  const full = sizeOf(item.img);
  return `<div style="width:${Math.round(w * s)}px;height:${Math.round(h * s)}px;position:relative;overflow:hidden;border-radius:14px;
    box-shadow:0 0 0 1px ${th.border},0 24px 60px rgba(0,0,0,.28),0 4px 14px rgba(0,0,0,.18);background:#fff">
    <img src="${png(item.img)}" style="position:absolute;left:${-x * s}px;top:${-y * s}px;width:${full.w * s}px;height:${full.h * s}px;image-rendering:auto"></div>`;
}

function screenshotPage(def, lang) {
  const th = THEMES[def.theme];
  const [title, sub] = def[lang];
  const gap = 36;
  const maxW = 1120;
  const maxH = 520;
  const sumW = def.items.reduce((a, i) => a + i.crop[2], 0) + gap * (def.items.length - 1);
  const maxItemH = Math.max(...def.items.map((i) => i.crop[3]));
  const s = Math.min(1, maxW / sumW, maxH / maxItemH);
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><body style="margin:0;width:1280px;height:800px;overflow:hidden;
    background:${th.bg};color:${th.fg};font-family:${FONT};display:flex;flex-direction:column;align-items:center">
    <div style="margin-top:44px;text-align:center;max-width:1120px">
      <div style="font-size:54px;font-weight:700;letter-spacing:-.02em;line-height:1.1">${esc(title)}</div>
      <div style="margin-top:14px;font-size:24px;line-height:1.35;text-wrap:balance;color:${th.sub}">${esc(sub)}</div>
    </div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:${gap}px;padding-bottom:36px">
      ${def.items.map((i) => shotHtml(i, s, th)).join('')}
    </div></body></html>`;
}

const TAGLINE = 'A sharper GitHub pull request workflow';

function tileHtml() {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:440px;height:280px;overflow:hidden;
    background:linear-gradient(150deg,#0d1117 0%,#1b1f3b 100%);color:#f0f6fc;font-family:${FONT};
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    <img src="${iconUrl}" style="width:96px;height:96px;border-radius:22px;box-shadow:0 8px 24px rgba(0,0,0,.45)">
    <div style="margin-top:16px;font-size:40px;font-weight:700;letter-spacing:-.02em">Better GHub</div>
    <div style="margin-top:6px;font-size:18px;color:#b6c0cc;padding:0 24px;line-height:1.3">${esc(TAGLINE)}</div></body>`;
}

function marqueeHtml() {
  const shot = { img: 'w2-list-filtered', crop: [57, 285, 1233, 615] };
  const s = 0.62;
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1400px;height:560px;overflow:hidden;position:relative;
    background:linear-gradient(150deg,#0d1117 0%,#1b1f3b 100%);color:#f0f6fc;font-family:${FONT}">
    <div style="position:absolute;left:90px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center">
      <img src="${iconUrl}" style="width:120px;height:120px;border-radius:26px;box-shadow:0 10px 30px rgba(0,0,0,.45)">
      <div style="margin-top:28px;font-size:76px;font-weight:700;letter-spacing:-.03em;line-height:1">Better GHub</div>
      <div style="margin-top:18px;font-size:32px;line-height:1.3;color:#c3ccd6">${esc(TAGLINE)}</div>
    </div>
    <div style="position:absolute;left:720px;top:96px">${shotHtml(shot, s, THEMES.dark)}</div></body>`;
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'screenshots/pl'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'promo'), { recursive: true });
  const browser = await chromium.launch({ executablePath: resolveChrome() });
  const render = async (html, w, h, file) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    await page.screenshot({ path: file, type: 'png' });
    await page.close();
    console.log('wrote', path.relative(ROOT, file));
  };
  try {
    for (const def of SCREENSHOTS) {
      LANG = 'en';
      await render(screenshotPage(def, 'en'), 1280, 800, path.join(OUT, 'screenshots', `${def.file}.png`));
      LANG = 'pl';
      await render(screenshotPage(def, 'pl'), 1280, 800, path.join(OUT, 'screenshots/pl', `${def.file}.png`));
    }
    LANG = 'en';
    await render(tileHtml(), 440, 280, path.join(OUT, 'promo/small-tile-440x280.png'));
    await render(marqueeHtml(), 1400, 560, path.join(OUT, 'promo/marquee-1400x560.png'));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
