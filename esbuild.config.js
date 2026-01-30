const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Entry points for the extension
const entryPoints = {
  // Content scripts
  'content': 'src/content.ts',
  'dashboard': 'src/dashboard.ts',
  
  // Background service worker
  'background': 'src/background.ts',
  
  // Popup and options pages
  'popup/popup': 'popup/popup.ts',
  'options/options': 'options/options.ts',
};

// Common build options
const buildOptions = {
  entryPoints: Object.entries(entryPoints).map(([outfile, input]) => ({
    in: input,
    out: outfile,
  })),
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'es2021',
  sourcemap: true,
  minify: !isWatch,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
};

// Copy static files to dist
function copyStaticFiles() {
  const staticFiles = [
    { src: 'manifest.json', dest: 'dist/manifest.json' },
    { src: 'icons', dest: 'dist/icons' },
    { src: '_locales', dest: 'dist/_locales' },
    { src: 'src/styles.css', dest: 'dist/styles.css' },
    { src: 'src/dashboard-styles.css', dest: 'dist/dashboard-styles.css' },
    // HTML files use Chrome's native __MSG_*__ syntax - just copy them
    { src: 'popup/popup.html', dest: 'dist/popup/popup.html' },
    { src: 'popup/popup.css', dest: 'dist/popup/popup.css' },
    { src: 'options/options.html', dest: 'dist/options/options.html' },
    { src: 'options/options.css', dest: 'dist/options/options.css' },
  ];

  // Ensure dist directories exist
  const dirs = ['dist', 'dist/popup', 'dist/options', 'dist/icons', 'dist/_locales'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  staticFiles.forEach(({ src, dest }) => {
    if (fs.existsSync(src)) {
      if (fs.statSync(src).isDirectory()) {
        copyDir(src, dest);
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  });
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function build() {
  try {
    console.log('Building extension...');
    
    // Copy static files first
    copyStaticFiles();
    
    if (isWatch) {
      // Watch mode
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      // Single build
      await esbuild.build(buildOptions);
      console.log('Build complete!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
