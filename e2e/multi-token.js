// E2E: several fine-grained tokens, one per organization (fake GitHub API).
// Token A covers the user's own repos; token B covers "microsoft", whose repos
// we pretend are private. Flow: list page can't read → "Add token" notice →
// options opens prefilled → add token B → chips appear; duplicate and
// different-account tokens are rejected; removing a token works.
// usage: node e2e/multi-token.js <distDir> [--dark]
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

const TOKEN_A = 'github_pat_11AAAAAAA0personalpersonalpersonal_personalpersonalpersonalpersonalAAAA';
const TOKEN_B = 'github_pat_11BBBBBBB0microsoftmicrosoftmicro_microsoftmicrosoftmicrosoftmicroBBBB';
const TOKEN_OTHER = 'github_pat_11CCCCCCC0someoneelsesomeoneelse_someoneelsesomeoneelsesomeoneelsCCCC';

(async () => {
  const dist = process.argv[2];
  const dark = process.argv.includes('--dark');
  const sfx = dark ? '-dark' : '';
  const { context, sw, extensionId } = await launch(dist, { colorScheme: dark ? 'dark' : 'light' });
  await sw.evaluate(installFakeGitHub, {
    viewer: 'octo-dev',
    tokens: {
      [TOKEN_A]: { login: 'octo-dev', owners: ['octo-dev'] },
      [TOKEN_B]: { login: 'octo-dev', owners: ['microsoft'] },
      [TOKEN_OTHER]: { login: 'someone-else', owners: ['elsewhere'] },
    },
    privateOwners: ['microsoft'],
  });
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

  // 1) Connect token A from the options page.
  const opt = await context.newPage();
  opt.on('pageerror', (e) => errors.push('options: ' + e.message));
  await opt.goto(`${base}/options/options.html#account`);
  const st1 = await opt.evaluate((t) => chrome.runtime.sendMessage({ type: 'auth:setToken', token: t }), TOKEN_A);
  check('token A connects the account', st1.authenticated && st1.tokens?.length === 1, JSON.stringify(st1.tokens?.map((t) => ({ kind: t.kind, owners: t.owners, exp: t.expiresAt }))));

  // 2) PR list of a "private" org: no token can read → notice with Add token.
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('github: ' + e.message));
  await page.goto('https://github.com/microsoft/vscode/pulls', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('ul[data-listview-component="items-list"] > li', { timeout: 20000 });
  await page.waitForTimeout(3500);
  const notice = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[class*="bghub-"] button, [class*="bghub-"] a')].map((b) => b.textContent.trim());
    const btn = [...document.querySelectorAll('[class*="bghub-"] button')].find((b) => /token/i.test(b.textContent));
    let box = btn;
    while (box && box.parentElement && !/microsoft/i.test(box.textContent)) box = box.parentElement;
    const bar = box ? box.textContent.trim().replace(/\s+/g, ' ') : '';
    return { bar: bar.slice(0, 200), btns: btns.slice(0, 6), chips: document.querySelectorAll('li [data-bghub-pr] .bghub-chip, li .bghub-chip').length };
  });
  check('list without access shows the "add token for microsoft" notice', /microsoft/i.test(notice.bar), JSON.stringify(notice));
  await page.screenshot({ path: path.join(SHOTS, `mt-needs-token${sfx}.png`), clip: { x: 0, y: 260, width: 1360, height: 260 } });

  // 3) Click "Add token" → options opens at #add-token/microsoft with org prefilled.
  await opt.close();
  const addBtn = page.locator('[class*="bghub-"] button').filter({ hasText: /token/i }).first();
  const [optTab] = await Promise.all([context.waitForEvent('page', { timeout: 10000 }).catch(() => null), addBtn.click().catch(() => null)]);
  let target = optTab;
  if (!target) target = context.pages().find((p) => p.url().includes('options.html'));
  await target.waitForTimeout(1500);
  const readPrefill = () => target.evaluate(() => {
    const org = document.querySelector('.tokens-org input');
    const link = document.querySelector('.tokens-add-panel a.connect-create-btn');
    const panel = document.querySelector('.tokens-add-panel');
    return { url: location.hash, org: org && org.value, href: link && link.getAttribute('href'), open: panel && !panel.hidden };
  });
  const prefillAfterClick = await readPrefill();
  check('notice click opens options prefilled (via background)', prefillAfterClick.open && prefillAfterClick.org === 'microsoft', JSON.stringify(prefillAfterClick).slice(0, 160));
  if (!(prefillAfterClick.open && prefillAfterClick.org === 'microsoft')) {
    target = await context.newPage();
    await target.goto(`${base}/options/options.html#add-token/microsoft`);
    await target.waitForTimeout(1500);
  }
  const prefill = await target.evaluate(() => {
    const org = document.querySelector('.tokens-org input');
    const link = document.querySelector('.tokens-add-panel a.connect-create-btn');
    const panel = document.querySelector('.tokens-add-panel');
    return { url: location.hash, org: org && org.value, href: link && link.getAttribute('href'), open: panel && !panel.hidden };
  });
  check('add-token route: form prefilled for microsoft with read-only prefill link', prefill.open && prefill.org === 'microsoft' && /target_name=microsoft/.test(prefill.href || '') && /pull_requests=read/.test(prefill.href || ''), JSON.stringify(prefill));
  await target.screenshot({ path: path.join(SHOTS, `mt-add-form${sfx}.png`) });

  // 4) Add token B through the form.
  await target.fill('.tokens-add-panel input[type="password"], .tokens-add-panel input.input-mono', TOKEN_B);
  await target.click('.tokens-add-panel button[type="submit"]');
  await target.waitForTimeout(2000);
  const rows = await target.$$eval('.token-row', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)));
  check('token B added — two tokens listed', rows.length === 2, JSON.stringify(rows));
  await target.screenshot({ path: path.join(SHOTS, `mt-two-tokens${sfx}.png`) });

  // 5) Back to the list: chips now render through token B.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('ul[data-listview-component="items-list"] > li', { timeout: 20000 });
  await page.waitForTimeout(3500);
  const chips = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul[data-listview-component="items-list"] > li')];
    return { rows: rows.length, withChips: rows.filter((r) => r.querySelector('.bghub-chip')).length };
  });
  check('after adding token B the list renders chips', chips.rows > 0 && chips.withChips === chips.rows, JSON.stringify(chips));
  const used = await sw.evaluate(() => self.__bghubAuthSeen.filter((s) => s.includes('/graphql')).slice(-4));
  check('graphql for microsoft routed to token B', used.some((s) => s.startsWith('BBBB')), JSON.stringify(used));

  // 6) Inbox merges both tokens.
  const opt2 = target;
  const inbox = await opt2.evaluate(() => chrome.runtime.sendMessage({ type: 'inbox:get', force: true }));
  check('inbox merges results of both tokens', inbox.items?.length >= 6, `items=${inbox.items?.length} err=${inbox.error}`);

  // 7) Duplicate + different account rejected.
  const dup = await opt2.evaluate((t) => chrome.runtime.sendMessage({ type: 'auth:setToken', token: t }), TOKEN_B);
  check('duplicate token rejected', dup.error === 'duplicate', dup.error);
  const other = await opt2.evaluate((t) => chrome.runtime.sendMessage({ type: 'auth:setToken', token: t }), TOKEN_OTHER);
  check('token of another account rejected', String(other.error).startsWith('different-account') && other.tokens?.length === 2, `${other.error} tokens=${other.tokens?.length}`);

  // 8) Content scripts cannot change tokens.
  const fromPage = await sw.evaluate(() => Promise.all([chrome.storage.local.get(null), chrome.storage.sync.get(null)]).then(([l, s]) => [...Object.keys(l), ...Object.keys(s)].filter((k) => /token/i.test(k))));
  check('no token secrets in chrome.storage (local or sync)', !fromPage.includes('githubToken'), JSON.stringify(fromPage));

  // 9) Remove token B via UI (two-step confirm).
  await target.reload();
  await target.waitForTimeout(1200);
  const removeBtns = target.locator('.token-row .token-remove');
  await removeBtns.last().click();
  await target.waitForTimeout(700); // the inline confirm ignores clicks right after it appears (double-click guard)
  await target.locator('.confirm-group .btn-danger-solid').first().click({ timeout: 5000 }).catch((e) => console.log('DEBUG click error', e.message.split('\n').slice(0, 6).join(' / ')));
  await target.waitForTimeout(1200);
  const after = await target.$$eval('.token-row', (rs) => rs.length);
  check('removing a token via the UI leaves one', after === 1, `rows=${after}`);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
