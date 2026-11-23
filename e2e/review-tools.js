// E2E: review features on a live public PR that touches package-lock.json.
// usage: node e2e/review-tools.js <distDir> [prFilesPath] [--dark]
const { launch, shotsDir } = require('./launch');
const path = require('path');
const fs = require('fs');

const SHOTS = shotsDir();
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  const dist = process.argv[2];
  const prPath = process.argv[3]?.startsWith('/') ? process.argv[3] : '/ZeroWiggliness/vscode-httpyac/pull/21/files';
  const dark = process.argv.includes('--dark');
  const sfx = dark ? '-dark' : '';
  const { context } = await launch(dist, { colorScheme: dark ? 'dark' : 'light' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://github.com' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`https://github.com${prPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.js-file', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const files = () =>
    page.$$eval('.js-file', (fs) =>
      fs.map((f) => ({
        path: f.querySelector('.file-header')?.getAttribute('data-path'),
        open: f.querySelector('.js-details-target')?.getAttribute('aria-expanded') === 'true',
        chip: !!f.querySelector('.file-header [class*="bghub-"]'),
      }))
    );
  const f0 = await files();
  const lock = f0.find((f) => /package-lock\.json$/.test(f.path || ''));
  const src = f0.find((f) => /package\.json$/.test(f.path || ''));
  check('package-lock.json auto-collapsed with a "Generated" chip', !!lock && !lock.open && lock.chip, JSON.stringify(lock));
  check('package.json left expanded, no chip', !!src && src.open && !src.chip, JSON.stringify(src));
  const toast = await page.evaluate(() => [...document.querySelectorAll('[class*="bghub-toast"]')].map((t) => t.textContent.trim()).join(' | '));
  check('toast announces collapsed generated files', /1|generat|wygenerow/i.test(toast), toast.slice(0, 120));
  await page.screenshot({ path: path.join(SHOTS, `w1-generated${sfx}.png`) });

  // Alt+Shift+G expands generated files, again collapses them
  await page.mouse.click(5, 400);
  await page.keyboard.press('Alt+Shift+KeyG');
  await page.waitForTimeout(700);
  const f1 = await files();
  check('Alt+Shift+G expands generated files', f1.find((f) => f.path === lock?.path)?.open === true);
  await page.keyboard.press('Alt+Shift+KeyG');
  await page.waitForTimeout(700);
  const f2 = await files();
  check('Alt+Shift+G again collapses them', f2.find((f) => f.path === lock?.path)?.open === false && f2.find((f) => f.path === src?.path)?.open === true);

  // Alt+G copies the checkout command
  await page.keyboard.press('Alt+KeyG');
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message));
  const n = prPath.match(/\/pull\/(\d+)/)[1];
  check('Alt+G copies `gh pr checkout <n>`', clip === `gh pr checkout ${n}`, clip);

  // Alt+V while logged out → explanatory toast, no crash
  await page.keyboard.press('Alt+KeyV');
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => [...document.querySelectorAll('.bghub-toast-text')].map((t) => t.textContent.trim()).join(' | '));
  check('Alt+V logged out explains sign-in is needed', /sign in|zaloguj/i.test(t2), t2.slice(0, 100));

  // Alt+T opens the threads panel; Esc closes it
  await page.keyboard.press('Alt+KeyT');
  await page.waitForTimeout(600);
  const panel = await page.evaluate(() => {
    const p = document.querySelector('.bghub-tp');
    return p ? { open: p.matches(':popover-open') || !p.hidden, text: p.textContent.trim().replace(/\s+/g, ' ').slice(0, 100) } : null;
  });
  check('Alt+T opens the unresolved threads panel', !!panel && panel.open, JSON.stringify(panel));
  await page.screenshot({ path: path.join(SHOTS, `w1-threads-panel${sfx}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Cheat sheet lists 16 actions
  await page.keyboard.press('Alt+Slash');
  await page.waitForTimeout(500);
  const rows = await page.evaluate(() => document.querySelectorAll('dialog[open] kbd, dialog[open] .bghub-kbd-group').length);
  await page.screenshot({ path: path.join(SHOTS, `w1-cheatsheet${sfx}.png`) });
  check('cheat sheet shows the new shortcuts', rows >= 16, `kbd groups=${rows}`);
  await page.keyboard.press('Escape');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
