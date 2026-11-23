// E2E: Files-tab tools on a live public PR (logged out): Alt+P file finder,
// Alt+W whitespace toggle, Alt+S split/unified toggle.
// usage: node e2e/diff-tools.js <distDir> [prFilesPath] [--dark]
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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`https://github.com${prPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.js-file', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(5, 400);

  // Alt+P: finder lists the changed files, filters, Enter jumps to the file.
  const fileCount = await page.$$eval('.js-file', (fs) => fs.length);
  await page.keyboard.press('Alt+KeyP');
  await page.waitForSelector('dialog.bghub-finder[open]', { timeout: 3000 });
  const listed = await page.$$eval('dialog.bghub-finder .bghub-ff-option', (os) => os.length);
  check('Alt+P opens the finder with every changed file', listed === fileCount, `${listed}/${fileCount}`);
  check('finder input has focus', await page.evaluate(() => document.activeElement?.classList.contains('bghub-ff-input')));
  await page.keyboard.type('pkglock');
  await page.waitForTimeout(200);
  const first = await page.$eval('dialog.bghub-finder .bghub-ff-option', (o) => o.getAttribute('title'));
  check('fuzzy query ranks package-lock.json first', /package-lock\.json$/.test(first || ''), first);
  await page.screenshot({ path: path.join(SHOTS, `finder${sfx}.png`) });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const after = await page.evaluate((p) => {
    const header = [...document.querySelectorAll('.file-header[data-path]')].find((h) => h.getAttribute('data-path') === p);
    const r = header?.getBoundingClientRect();
    return { closed: !document.querySelector('dialog.bghub-finder[open]'), top: r ? Math.round(r.top) : null };
  }, first);
  check('Enter closes the finder and scrolls to the file', after.closed && after.top !== null && after.top > -50 && after.top < 500, JSON.stringify(after));

  // Alt+W / Alt+S change the diff URL params.
  await Promise.all([page.waitForURL(/[?&]w=1/, { timeout: 15000 }).catch(() => {}), page.keyboard.press('Alt+KeyW')]);
  check('Alt+W hides whitespace (w=1)', /[?&]w=1/.test(page.url()), page.url());
  await page.waitForSelector('.js-file', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(5, 400);
  await Promise.all([page.waitForURL(/[?&]diff=(split|unified)/, { timeout: 15000 }).catch(() => {}), page.keyboard.press('Alt+KeyS')]);
  check('Alt+S switches the diff layout', /[?&]diff=(split|unified)/.test(page.url()) && /[?&]w=1/.test(page.url()), page.url());

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
