// E2E: ready/stale chips + quick filters on the live PR list, popup pin/snooze.
// usage: node e2e/list-filters-and-inbox.js <distDir> [--dark]
const { launch, shotsDir } = require('./launch');
const { installFakeGitHub } = require('./fake-github');
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
  const dark = process.argv.includes('--dark');
  const sfx = dark ? '-dark' : '';
  const { context, sw, extensionId } = await launch(dist, { colorScheme: dark ? 'dark' : 'light' });
  await sw.evaluate(installFakeGitHub, { viewer: 'octo-dev' });
  await context.addInitScript(() => {
    new MutationObserver((_, mo) => {
      const m = document.querySelector('meta[name="user-login"]');
      if (m) {
        m.setAttribute('content', 'octo-dev');
        mo.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const base = `chrome-extension://${extensionId}`;
  const errors = [];

  const opt = await context.newPage();
  await opt.goto(`${base}/options/options.html#about`);
  await opt.evaluate(() => chrome.runtime.sendMessage({ type: 'auth:setToken', token: 'github_pat_11AAAAAAA0FAKEFAKEFAKE_fakefakefakefakefakefakefakefakefakefakefakefakefake' }));

  // ---------- PR list ----------
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('github: ' + e.message));
  await page.goto('https://github.com/microsoft/vscode/pulls', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('ul[data-listview-component="items-list"] > li', { timeout: 20000 });
  await page.waitForTimeout(3500);

  const state = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('ul[data-listview-component="items-list"] > li')];
      const visible = rows.filter((r) => !r.hasAttribute('data-bghub-filtered') && r.getAttribute('aria-hidden') !== 'true');
      return {
        rows: rows.length,
        visible: visible.length,
        ready: rows.filter((r) => r.querySelector('.bghub-prl-ready')).length,
        stale: rows.filter((r) => r.querySelector('.bghub-prl-stale')).length,
        visibleReady: visible.filter((r) => r.querySelector('.bghub-prl-ready')).length,
        filters: [...document.querySelectorAll('.bghub-prl-filter')].map((b) => `${b.dataset.filter}:${b.querySelector('.bghub-prl-filter-count')?.textContent ?? '-'}`),
      };
    });
  const s0 = await state();
  check('ready and stale chips rendered', s0.ready > 0 && s0.stale > 0, JSON.stringify(s0));
  check('quick filter bar with live counts', s0.filters.length >= 5 && s0.filters.some((f) => f === `ready:${s0.ready}`), s0.filters.join(' '));
  await page.screenshot({ path: path.join(SHOTS, `w2-list${sfx}.png`) });

  await page.click('.bghub-prl-filter[data-filter="ready"]');
  await page.waitForTimeout(500);
  const s1 = await state();
  check('"Ready to merge" filter shows only ready rows', s1.visible === s0.ready && s1.visibleReady === s0.ready, JSON.stringify({ visible: s1.visible, ready: s0.ready }));
  await page.screenshot({ path: path.join(SHOTS, `w2-list-filtered${sfx}.png`) });
  const pressed = await page.getAttribute('.bghub-prl-filter[data-filter="ready"]', 'aria-pressed');
  check('filter chip exposes aria-pressed', pressed === 'true', pressed);
  await page.click('.bghub-prl-filter[data-filter="ready"]');
  await page.waitForTimeout(400);
  const s2 = await state();
  check('toggling the filter off shows all rows again', s2.visible === s2.rows, `${s2.visible}/${s2.rows}`);

  // ---------- Popup: pin + snooze ----------
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push('popup: ' + e.message));
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`${base}/popup/popup.html`);
  await popup.waitForSelector('.pr-actions', { timeout: 10000 });
  await popup.waitForTimeout(800);
  const urls = await popup.$$eval('.pr-actions', (bs) => bs.map((b) => b.dataset.url));
  const lastUrl = urls[urls.length - 1];
  // Pin the last row of the tab → it moves to the top
  await popup.click(`.pr-actions[data-url="${lastUrl}"]`);
  await popup.waitForSelector('[role="menu"] .menu-item', { timeout: 3000 });
  await popup.screenshot({ path: path.join(SHOTS, `w2-popup-menu${sfx}.png`) });
  await popup.locator('[role="menu"] .menu-item').first().click(); // Pin
  await popup.waitForTimeout(700);
  const firstNow = await popup.$eval('.pr-actions', (b) => b.dataset.url);
  check('pinning moves the PR to the top', firstNow === lastUrl, `${firstNow}`);
  const inbox1 = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'inbox:get' }));
  check('pin persisted in the background', inbox1.items.find((i) => i.url === lastUrl)?.pinned === true);

  // Snooze the (now first) row for 1 hour → leaves the tab, appears under "Snoozed"
  const badgeBefore = await sw.evaluate(() => chrome.action.getBadgeText({}));
  await popup.click(`.pr-actions[data-url="${lastUrl}"]`);
  await popup.waitForSelector('[role="menu"] .menu-item', { timeout: 3000 });
  await popup.locator('[role="menu"] .menu-item').nth(1).click(); // Snooze 1h
  await popup.waitForTimeout(800);
  const snoozed = await popup.evaluate((u) => ({
    inTab: !!document.querySelector(`.pr-actions[data-url="${u}"]`),
    inSnoozed: [...document.querySelectorAll('.snoozed-item')].some((li) => li.dataset.url === u),
  }), lastUrl);
  check('snoozed PR leaves the tab and is listed under Snoozed', !snoozed.inTab && snoozed.inSnoozed, JSON.stringify(snoozed));
  const inbox2 = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'inbox:get' }));
  const it = inbox2.items.find((i) => i.url === lastUrl);
  check('snooze persisted (~1h ahead)', !!it?.snoozedUntil && Date.parse(it.snoozedUntil) - Date.now() > 50 * 60 * 1000, it?.snoozedUntil);
  const badgeAfter = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('badge excludes snoozed PRs', inbox2.unseenCount <= (Number(badgeBefore) || 0) && badgeAfter === (inbox2.unseenCount ? String(inbox2.unseenCount) : ''), `before=${badgeBefore} after=${badgeAfter} unseen=${inbox2.unseenCount}`);
  await popup.screenshot({ path: path.join(SHOTS, `w2-popup-snoozed${sfx}.png`) });
  const readyChips = await popup.$$eval('.badge, .chip, [class*="ready"]', (els) => els.filter((e) => /ready|gotow/i.test(e.textContent)).length);
  check('popup rows show "Ready to merge"', readyChips > 0, `n=${readyChips}`);

  // Options: Files changed section renders, pattern tester works
  const o = await context.newPage();
  o.on('pageerror', (e) => errors.push('options: ' + e.message));
  await o.goto(`${base}/options/options.html#files`);
  await o.waitForTimeout(1000);
  const tester = await o.$('input[type="text"][placeholder*="/"], .files-test input, input[aria-describedby*="test"]');
  if (tester) {
    await tester.fill('packages/ui/pnpm-lock.yaml');
    await o.waitForTimeout(300);
  }
  await o.screenshot({ path: path.join(SHOTS, `w2-options-files${sfx}.png`), fullPage: true });
  await o.goto(`${base}/options/options.html#notifications`);
  await o.waitForTimeout(800);
  await o.screenshot({ path: path.join(SHOTS, `w2-options-notifications${sfx}.png`), fullPage: true });
  check('options sections render without errors', errors.filter((e) => e.startsWith('options')).length === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
