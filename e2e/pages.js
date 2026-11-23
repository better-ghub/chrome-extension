// E2E: popup + options pages inside the real extension, fake GitHub API.
// usage: node e2e/pages.js <distDir> [--dark]
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
  const base = `chrome-extension://${extensionId}`;
  const errors = [];

  // ---------- Popup: signed out ----------
  const popup = await context.newPage();
  popup.on('pageerror', (e) => errors.push('popup: ' + e.message));
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`${base}/popup/popup.html`);
  await popup.waitForSelector('form.connect-form', { timeout: 10000 });
  await popup.screenshot({ path: path.join(SHOTS, `popup-signed-out${sfx}.png`) });
  check('popup: signed-out connect form shown', true);

  // Invalid format → inline error, no request
  await popup.fill('form.connect-form input', 'nope');
  await popup.click('form.connect-form button[type="submit"]');
  await popup.waitForTimeout(400);
  const err = await popup.$eval('.field-error', (e) => (!e.hidden ? e.textContent.trim() : '')).catch(() => '');
  check('popup: invalid token shows inline error', err.length > 0, err.slice(0, 80));

  // Valid (fake) token → signed in + inbox
  await popup.fill('form.connect-form input', 'github_pat_11AAAAAAA0FAKEFAKEFAKE_fakefakefakefakefakefakefakefakefakefakefakefakefake');
  await popup.click('form.connect-form button[type="submit"]');
  await popup.waitForTimeout(2500);
  const signedIn = await popup.evaluate(() => document.body.textContent.includes('octo-dev'));
  check('popup: connects and shows the account', signedIn);
  const rows = await popup.evaluate(() => document.querySelectorAll('[role="tabpanel"] li, .inbox-row, [class*="inbox-item"]').length);
  check('popup: inbox rows rendered', rows > 0, `rows=${rows}`);
  await popup.screenshot({ path: path.join(SHOTS, `popup-inbox${sfx}.png`) });

  // Switch tab (Your PRs)
  const tabs = await popup.$$('[role="tab"]');
  if (tabs.length > 1) {
    await tabs[1].click();
    await popup.waitForTimeout(400);
    await popup.screenshot({ path: path.join(SHOTS, `popup-inbox-mine${sfx}.png`) });
  }
  check('popup: has inbox tabs', tabs.length >= 2, `tabs=${tabs.length}`);

  // Mark all as read → badge cleared
  const markAll = await popup.$('button:has-text("Mark all"), button:has-text("Oznacz")');
  if (markAll) {
    await markAll.click();
    await popup.waitForTimeout(800);
    const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
    check('popup: mark all as read clears the badge', badge === '', `badge="${badge}"`);
  } else check('popup: mark-all-read button present', false);

  // ---------- Options ----------
  const opt = await context.newPage();
  opt.on('pageerror', (e) => errors.push('options: ' + e.message));
  await opt.setViewportSize({ width: 1200, height: 900 });
  await opt.goto(`${base}/options/options.html#account`);
  await opt.waitForTimeout(1200);
  await opt.screenshot({ path: path.join(SHOTS, `options-account${sfx}.png`) });
  await opt.goto(`${base}/options/options.html#shortcuts`);
  await opt.waitForTimeout(1000);
  await opt.locator('#h-shortcuts').scrollIntoViewIfNeeded().catch(() => {});
  await opt.screenshot({ path: path.join(SHOTS, `options-shortcuts${sfx}.png`) });

  // Record a new binding for the first row (toggleComments): Ctrl+Alt+KeyX
  const firstKey = opt.locator('.sc-row[data-action="toggleComments"] .sc-controls button').last();
  await firstKey.click();
  await opt.waitForTimeout(200);
  await opt.screenshot({ path: path.join(SHOTS, `options-recording${sfx}.png`) });
  await opt.keyboard.press('Control+Alt+KeyX');
  await opt.waitForTimeout(600);
  const stored = await sw.evaluate(() => chrome.storage.sync.get('shortcutBindings'));
  const tc = stored.shortcutBindings && stored.shortcutBindings.toggleComments;
  check('options: recorder saves Ctrl+Alt+X', !!tc && tc.code === 'KeyX' && tc.ctrl && tc.alt, JSON.stringify(tc));

  // Duplicate: try to give copyBranch the same combo → inline error, not saved
  await opt.locator('.sc-row[data-action="copyBranch"] .sc-controls button').last().click();
  await opt.waitForTimeout(200);
  await opt.keyboard.press('Control+Alt+KeyX');
  await opt.waitForTimeout(500);
  const dupMsg = await opt.locator('.sc-row[data-action="copyBranch"] .sc-message').textContent();
  const stored2 = await sw.evaluate(() => chrome.storage.sync.get('shortcutBindings'));
  check('options: duplicate combo is reported, not saved', dupMsg.trim().length > 0 && stored2.shortcutBindings.copyBranch.code === 'KeyB', dupMsg.trim().slice(0, 80));
  await opt.screenshot({ path: path.join(SHOTS, `options-duplicate${sfx}.png`) });
  await opt.keyboard.press('Escape');

  // Toggle a setting → storage updated
  await opt.goto(`${base}/options/options.html#pr-list`);
  await opt.waitForTimeout(600);
  await opt.click('#set-labels');
  await opt.waitForTimeout(400);
  const lab = await sw.evaluate(() => chrome.storage.sync.get('suggestedLabelsEnabled'));
  check('options: toggling a switch persists the setting', lab.suggestedLabelsEnabled === false, JSON.stringify(lab));

  // Language switch in place
  await opt.goto(`${base}/options/options.html#language`);
  await opt.waitForTimeout(600);
  await opt.selectOption('#set-language', 'pl');
  await opt.waitForTimeout(800);
  const lang = await opt.evaluate(() => document.documentElement.lang);
  check('options: language switches without reload', lang === 'pl', `lang=${lang}`);
  await opt.screenshot({ path: path.join(SHOTS, `options-pl${sfx}.png`), fullPage: false });

  check('no page errors in popup/options', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
