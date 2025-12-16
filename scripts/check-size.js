#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('📊 Checking extension bundle size...\n');

const MAX_SIZE_MB = 5; // Chrome Web Store limit is much higher, but let's keep it small
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

function getDirectorySize(dirPath) {
  let totalSize = 0;
  
  const files = fs.readdirSync(dirPath);
  
  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    // Skip directories we don't want to include
    if (stats.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.github') {
        return;
      }
      totalSize += getDirectorySize(filePath);
    } else {
      // Skip certain files
      if (file.endsWith('.md') || file === 'package.json' || file === 'package-lock.json') {
        return;
      }
      totalSize += stats.size;
    }
  });
  
  return totalSize;
}

try {
  const rootDir = path.join(__dirname, '..');
  const totalSize = getDirectorySize(rootDir);
  const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  
  console.log(`Total extension size: ${sizeMB} MB`);
  console.log(`Maximum allowed: ${MAX_SIZE_MB} MB`);
  
  if (totalSize > MAX_SIZE_BYTES) {
    console.error(`❌ Extension size (${sizeMB} MB) exceeds limit (${MAX_SIZE_MB} MB)`);
    process.exit(1);
  }
  
  const percentUsed = ((totalSize / MAX_SIZE_BYTES) * 100).toFixed(1);
  console.log(`✓ Size check passed (${percentUsed}% of limit used)`);
  
  // Check individual file sizes
  console.log('\n📁 Largest files:');
  const files = [];
  
  function collectFiles(dirPath, baseDir = '') {
    const items = fs.readdirSync(dirPath);
    items.forEach(item => {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        if (item !== 'node_modules' && item !== '.git' && item !== 'dist' && item !== '.github') {
          collectFiles(itemPath, path.join(baseDir, item));
        }
      } else {
        if (!item.endsWith('.md') && item !== 'package.json' && item !== 'package-lock.json') {
          files.push({
            path: path.join(baseDir, item),
            size: stats.size
          });
        }
      }
    });
  }
  
  collectFiles(rootDir);
  files.sort((a, b) => b.size - a.size);
  
  files.slice(0, 10).forEach(file => {
    const sizeKB = (file.size / 1024).toFixed(2);
    console.log(`  ${file.path}: ${sizeKB} KB`);
  });
  
  console.log('\n✅ Size check completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('❌ Error checking size:', error.message);
  process.exit(1);
}

