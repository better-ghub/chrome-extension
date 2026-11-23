// E2E: PR list chips on live github.com with a fake API behind the extension.
// usage: node e2e/pr-list.js <distDir> [--dark]
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
  console.log(await sw.evaluate(installFakeGitHub, { viewer: 'octo-dev' }));

  // Pretend GitHub's page is logged in as the viewer (content script reads meta[name=user-login]).
  await context.addInitScript(() => {
    new MutationObserver((_, mo) => {
      const m = document.querySelector('meta[name="user-login"]');
      if (m) {
        m.setAttribute('content', 'octo-dev');
        mo.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });

  // Connect through the real auth flow from an extension page.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/options/options.html`);
  const auth = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'auth:setToken', token: 'github_pat_11AAAAAAA0FAKEFAKEFAKE_fakefakefakefakefakefakefakefakefakefakefakefakefake' }));
  check('auth:setToken succeeds against fake API', auth && auth.authenticated === true, JSON.stringify(auth).slice(0, 160));
  const inbox = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'inbox:get', force: true }));
  check('inbox:get returns merged items', inbox && inbox.items && inbox.items.length >= 6, `items=${inbox?.items?.length} unseen=${inbox?.unseenCount} err=${inbox?.error}`);
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('toolbar badge shows unseen count', badge === String(inbox?.unseenCount || ''), `badge="${badge}"`);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://github.com/microsoft/vscode/pulls', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('ul[data-listview-component="items-list"] > li', { timeout: 20000 });
  await page.waitForTimeout(3500);

  const stats = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul[data-listview-component="items-list"] > li')];
    return {
      rows: rows.length,
      withChips: rows.filter((r) => r.querySelector('[class*="bghub-"]')).length,
      skeletons: document.querySelectorAll('.bghub-skeleton').length,
      summary: document.querySelector('[class*="bghub-summary"], [class*="bghub-topbar"], [class*="bghub-top-bar"]')?.textContent?.trim().slice(0, 140) ?? null,
      sampleRow: rows[0]?.querySelector('[data-bghub-pr], [class*="bghub-row"]')?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 200) ?? null,
      accent: document.querySelectorAll('li[data-bghub-accent]').length,
    };
  });
  check('chips rendered on every row', stats.rows > 0 && stats.withChips === stats.rows, JSON.stringify(stats));
  check('no skeletons left after load', stats.skeletons === 0);
  await page.screenshot({ path: path.join(SHOTS, `pr-list${sfx}.png`) });
  await page.locator('ul[data-listview-component="items-list"]').screenshot({ path: path.join(SHOTS, `pr-list-rows${sfx}.png`) }).catch(() => {});

  // Tooltip on hover
  const trigger = await page.$('ul[data-listview-component="items-list"] button[class*="bghub-"]');
  if (trigger) {
    await trigger.hover();
    await page.waitForTimeout(700);
    const tip = await page.evaluate(() => {
      const t = document.querySelector('[popover][class*="bghub-tooltip"]');
      return t ? { open: t.matches(':popover-open'), text: t.textContent.trim().slice(0, 100) } : null;
    });
    check('tooltip opens on hover (popover)', !!tip && tip.open, JSON.stringify(tip));
    await page.screenshot({ path: path.join(SHOTS, `pr-list-tooltip${sfx}.png`), clip: await trigger.boundingBox().then((b) => ({ x: Math.max(0, b.x - 200), y: Math.max(0, b.y - 140), width: 700, height: 360 })) });
  } else check('tooltip trigger present', false);

  // Re-render resilience: paginate / filter via soft navigation, chips must come back
  const calls0 = await sw.evaluate(() => self.__bghubFakeCalls.length);
  await page.click('a[href*="/pulls?page=2"], nav[aria-label*="agination"] a[rel="next"]').catch(() => {});
  await page.waitForTimeout(4000);
  const p2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul[data-listview-component="items-list"] > li')];
    return { url: location.href, rows: rows.length, withChips: rows.filter((r) => r.querySelector('[class*="bghub-"]')).length };
  });
  const calls1 = await sw.evaluate(() => self.__bghubFakeCalls.length);
  check('chips re-applied after soft navigation (page 2)', p2.withChips === p2.rows && p2.rows > 0, `${JSON.stringify(p2)} apiCalls+${calls1 - calls0}`);

  const paths = await sw.evaluate(() => self.__bghubFakeCalls);
  check('PR list uses batched GraphQL (no per-row REST)', !paths.some((p) => /\/pulls\/\d+/.test(p)), `${paths.length} calls: ${[...new Set(paths)].join(', ')}`);
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  await context.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
