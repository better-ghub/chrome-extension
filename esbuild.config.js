const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');
const isDev = isWatch || process.argv.includes('--dev');
const DIST = 'dist';

// Script entry points (outfile → source). CSS imported from a TS entry is
// emitted next to it (e.g. src/content/index.ts imports styles → dist/content.css).
const entryPoints = {
  content: 'src/content/index.ts',
  background: 'src/background.ts',
  'popup/popup': 'popup/popup.ts',
  'options/options': 'options/options.ts',
};

const buildOptions = {
  entryPoints: Object.entries(entryPoints).map(([out, input]) => ({ in: input, out })),
  bundle: true,
  outdir: DIST,
  format: 'iife',
  target: 'chrome116',
  // Sourcemaps only for dev builds: production zips must not ship full sources.
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  legalComments: 'none',
  logLevel: 'warning',
  define: {
    __DEV__: JSON.stringify(isDev),
  },
};

function copyDir(src, dest, filter = () => true) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) copyDir(s, d, filter);
    else if (filter(s)) fs.copyFileSync(s, d);
  }
}

// Static assets. Extension pages (popup/options) get every non-TS file in
// their folder copied as-is, so adding an .html/.css/.svg needs no config.
function copyStaticFiles() {
  fs.mkdirSync(DIST, { recursive: true });
  fs.copyFileSync('manifest.json', path.join(DIST, 'manifest.json'));
  // Only ship the sized icons (+ the SVG for pages); icons/icon.png is the 220 KB source art.
  copyDir('icons', path.join(DIST, 'icons'), (f) => /icon(16|32|48|128)\.png$|icon\.svg$/.test(f));
  copyDir('_locales', path.join(DIST, '_locales'));
  const notTs = (f) => !f.endsWith('.ts');
  copyDir('popup', path.join(DIST, 'popup'), notTs);
  copyDir('options', path.join(DIST, 'options'), notTs);
  if (fs.existsSync('shared')) copyDir('shared', path.join(DIST, 'shared'), notTs);
}

async function build() {
  const started = Date.now();
  try {
    fs.rmSync(DIST, { recursive: true, force: true });
    copyStaticFiles();

    if (isWatch) {
      const ctx = await esbuild.context({
        ...buildOptions,
        plugins: [
          {
            name: 'copy-static',
            setup(b) {
              b.onEnd(() => {
                try {
                  copyStaticFiles();
                } catch (e) {
                  console.error('Static copy failed:', e.message);
                }
              });
            },
          },
        ],
      });
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log(`Build complete in ${Date.now() - started}ms (${isDev ? 'dev' : 'production'}).`);
    }
  } catch (error) {
    console.error('Build failed:', error.message || error);
    process.exit(1);
  }
}

build();
