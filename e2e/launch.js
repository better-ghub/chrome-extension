// Shared launcher: Chrome for Testing with the unpacked extension loaded.
//
// Branded Google Chrome ignores --load-extension (since 137), so the suite
// needs Chrome for Testing / Chromium. Resolution order:
//   1. $CHROME_PATH
//   2. the build matching the installed playwright-core (`npm run e2e:install`)
//   3. the newest Chrome for Testing already in the Playwright cache
const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

function cacheDirs() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return [process.env.PLAYWRIGHT_BROWSERS_PATH];
  if (process.platform === 'darwin') return [path.join(os.homedir(), 'Library/Caches/ms-playwright')];
  if (process.platform === 'win32') return [path.join(os.homedir(), 'AppData/Local/ms-playwright')];
  return [path.join(os.homedir(), '.cache/ms-playwright')];
}

const BINARIES = [
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-win64/chrome.exe',
  'chrome-win/chrome.exe',
];

function findCachedChrome() {
  for (const dir of cacheDirs()) {
    if (!fs.existsSync(dir)) continue;
    const builds = fs
      .readdirSync(dir)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      for (const bin of BINARIES) {
        const exe = path.join(dir, build, bin);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const bundled = chromium.executablePath();
  if (bundled && fs.existsSync(bundled)) return bundled;
  const cached = findCachedChrome();
  if (cached) return cached;
  throw new Error('No Chrome for Testing found. Run `npm run e2e:install` or set CHROME_PATH.');
}

async function launch(extDir, { headless = process.env.HEADED !== '1', colorScheme = 'light' } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bghub-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: resolveChrome(),
    // Extensions need the "new" headless mode, passed as a flag below.
    headless: false,
    colorScheme,
    viewport: { width: 1360, height: 900 },
    args: [
      ...(headless ? ['--headless=new'] : []),
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  // E2E_LANG=en|pl pins the extension's UI language (screenshots for the store).
  if (process.env.E2E_LANG) await sw.evaluate((language) => chrome.storage.sync.set({ language }), process.env.E2E_LANG);
  return { context, sw, extensionId, userDataDir };
}

/** Where specs save screenshots: e2e/shots/, or e2e/shots/<lang>/ with E2E_LANG. */
function shotsDir() {
  return path.join(__dirname, 'shots', process.env.E2E_LANG || '');
}

module.exports = { launch, resolveChrome, shotsDir };
