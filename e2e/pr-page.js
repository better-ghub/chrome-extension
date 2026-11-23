// E2E: PR page shortcuts on live github.com (logged out, public repo).
// usage: node e2e/pr-page.js <distDir> [prPath] [--dark]
const { launch, shotsDir } = require('./launch');
const path = require('path');
const fs = require('fs');

const SHOTS = shotsDir();
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  const dist = process.argv[2];
  const prPath = process.argv[3]?.startsWith('/') ? process.argv[3] : '/microsoft/vscode/pull/349703';
  const dark = process.argv.includes('--dark');
  const { context } = await launch(dist, { colorScheme: dark ? 'dark' : 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /bghub|Better GHub/i.test(m.text())) errors.push(m.text());
  });

  // ---------- Conversation ----------
  await page.goto(`https://github.com${prPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('review-thread-collapsible, .js-timeline-item', { timeout: 20000 });
  await page.waitForTimeout(1500);

  const threadState = () =>
    page.$$eval('review-thread-collapsible', (els) =>
      els.map((e) => e.classList.contains('open') || e.querySelector('[data-target="review-thread-collapsible.button"]')?.getAttribute('aria-expanded') === 'true')
    );
  const before = await threadState();
  await page.mouse.click(5, 300); // focus the page body, not an input
  await page.keyboard.press('Alt+KeyC');
  await page.waitForTimeout(600);
  const after = await threadState();
  const target = !before.some(Boolean);
  check('conversation: Alt+C converges all threads (any open → collapse, else expand)', before.length > 0 && after.every((s) => s === target), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  await page.screenshot({ path: path.join(SHOTS, `conv-after-toggle${dark ? '-dark' : ''}.png`) });
  await page.keyboard.press('Alt+KeyC');
  await page.waitForTimeout(600);
  const after2 = await threadState();
  check('conversation: Alt+C again flips all', after2.every((s) => s === !target), JSON.stringify(after2));

  // Next unresolved thread
  const unresolvedCount = await page.$$eval('review-thread-collapsible[data-resolved="false"]', (e) => e.length);
  await page.keyboard.press('Alt+KeyJ');
  await page.waitForTimeout(900);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    const t = a && a.closest('review-thread-collapsible, .review-thread-component, .js-resolvable-timeline-thread-container');
    return t ? { resolved: t.getAttribute('data-resolved'), highlighted: !!document.querySelector('[class*="bghub-thread-focus"]') } : null;
  });
  if (unresolvedCount > 0) check('Alt+J focuses an unresolved thread', !!focused && focused.resolved !== 'true', JSON.stringify(focused));
  else {
    const toast = await page.evaluate(() => [...document.querySelectorAll('[class*="bghub-toast"]')].map((t) => t.textContent.trim()).join(' | '));
    check('Alt+J with no unresolved threads shows a toast', toast.length > 0, toast.slice(0, 120));
  }
  await page.screenshot({ path: path.join(SHOTS, `next-unresolved${dark ? '-dark' : ''}.png`) });

  // Copy markdown link
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://github.com' });
  await page.keyboard.press('Alt+KeyL');
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message));
  check('Alt+L copies a Markdown link', /^\[.+ \(#\d+\)\]\(https:\/\/github\.com\/.+\/pull\/\d+\)$/.test(clip), clip);
  await page.screenshot({ path: path.join(SHOTS, `toast-copied${dark ? '-dark' : ''}.png`) });

  // Cheat sheet
  await page.keyboard.press('Alt+Slash');
  await page.waitForTimeout(500);
  const dialogOpen = await page.evaluate(() => !!document.querySelector('dialog[open][class*="bghub"]'));
  check('Alt+/ opens the cheat sheet dialog', dialogOpen);
  await page.screenshot({ path: path.join(SHOTS, `cheatsheet${dark ? '-dark' : ''}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc closes the cheat sheet', await page.evaluate(() => !document.querySelector('dialog[open][class*="bghub"]')));

  // Typing guard: shortcut must not fire inside a textarea
  const hasTextarea = await page.$('textarea');
  if (hasTextarea) {
    const s0 = await threadState();
    await page.focus('textarea');
    await page.keyboard.press('Alt+KeyC');
    await page.waitForTimeout(400);
    const s1 = await threadState();
    check('shortcut ignored while typing in a textarea', JSON.stringify(s0) === JSON.stringify(s1));
    await page.mouse.click(5, 300);
  }

  // ---------- Soft navigation to Files tab (Alt+4) ----------
  await page.evaluate(() => ((window).__bghubMarker = 1));
  await page.keyboard.press('Alt+Digit4');
  await page.waitForURL(/\/pull\/\d+\/(files|changes)/, { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('.js-file, [class*="DiffFileHeader-module"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const soft = await page.evaluate(() => (window).__bghubMarker === 1);
  check('Alt+4 navigates to Files changed', /\/(files|changes)/.test(page.url()), `${page.url()} (soft nav: ${soft})`);

  const fileState = () =>
    page.$$eval('.js-file .file-header button.js-details-target', (bs) => bs.map((b) => b.getAttribute('aria-expanded') === 'true'));
  const f0 = await fileState();
  await page.mouse.click(5, 400);
  await page.keyboard.press('Alt+Shift+KeyF');
  await page.waitForTimeout(800);
  const f1 = await fileState();
  check('files: Alt+Shift+F collapses all files', f0.length > 0 && f1.every((s) => !s), `${f0.filter(Boolean).length}/${f0.length} open → ${f1.filter(Boolean).length}/${f1.length}`);
  await page.screenshot({ path: path.join(SHOTS, `files-collapsed${dark ? '-dark' : ''}.png`) });
  await page.keyboard.press('Alt+Shift+KeyF');
  await page.waitForTimeout(800);
  const f2 = await fileState();
  check('files: Alt+Shift+F again expands all', f2.every((s) => s), `${f2.filter(Boolean).length}/${f2.length}`);

  // Mixed state: collapse one file manually, then toggle → everything ends in ONE state
  const firstBtn = await page.$('.js-file .file-header button.js-details-target');
  if (firstBtn && f2.length > 1) {
    await firstBtn.click();
    await page.waitForTimeout(300);
    await page.mouse.click(5, 400);
    await page.keyboard.press('Alt+Shift+KeyF');
    await page.waitForTimeout(800);
    const f3 = await fileState();
    check('files: mixed state converges to a single state', f3.every((s) => s === f3[0]), JSON.stringify(f3));
  }

  // Comments toggle in classic files view
  const notes = () => page.$$eval('.js-file', (fs) => fs.map((f) => f.classList.contains('show-inline-notes')));
  const n0 = await notes();
  if (n0.some(Boolean)) {
    await page.keyboard.press('Alt+KeyC');
    await page.waitForTimeout(600);
    const n1 = await notes();
    check('files: Alt+C hides inline comments', n1.every((s) => !s), `${JSON.stringify(n0)} → ${JSON.stringify(n1)}`);
    await page.keyboard.press('Alt+KeyC');
    await page.waitForTimeout(600);
  }

  // Hint button present
  const hint = await page.evaluate(() => !!document.querySelector('[class*="bghub-hint"]'));
  check('floating shortcuts hint is rendered', hint);

  check('no page errors from the extension', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
