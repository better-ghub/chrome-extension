#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating manifest.json...\n');

try {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  let errors = 0;

  // Required fields
  const requiredFields = ['manifest_version', 'name', 'version', 'description'];
  requiredFields.forEach(field => {
    if (!manifest[field]) {
      console.error(`❌ Missing required field: ${field}`);
      errors++;
    } else {
      console.log(`✓ ${field}: ${manifest[field]}`);
    }
  });

  // Manifest version check
  if (manifest.manifest_version !== 3) {
    console.error(`❌ manifest_version must be 3, got ${manifest.manifest_version}`);
    errors++;
  }

  // Icons check
  if (!manifest.icons || !manifest.icons['16'] || !manifest.icons['48'] || !manifest.icons['128']) {
    console.error('❌ Missing required icons (16, 48, 128)');
    errors++;
  } else {
    console.log('✓ Icons defined');
    
    // Check if icon files exist
    ['16', '48', '128'].forEach(size => {
      const iconPath = path.join(__dirname, '..', manifest.icons[size]);
      if (!fs.existsSync(iconPath)) {
        console.error(`❌ Icon file missing: ${manifest.icons[size]}`);
        errors++;
      }
    });
  }

  // Content scripts check
  if (!manifest.content_scripts || manifest.content_scripts.length === 0) {
    console.error('❌ No content scripts defined');
    errors++;
  } else {
    console.log(`✓ ${manifest.content_scripts.length} content script(s) defined`);
  }

  // Permissions check
  if (manifest.permissions && manifest.permissions.length > 0) {
    console.log(`✓ Permissions: ${manifest.permissions.join(', ')}`);
  }

  // Host permissions check
  if (manifest.host_permissions && manifest.host_permissions.length > 0) {
    console.log(`✓ Host permissions: ${manifest.host_permissions.join(', ')}`);
  }

  console.log('\n' + '='.repeat(50));
  if (errors === 0) {
    console.log('✅ Manifest validation passed!');
    process.exit(0);
  } else {
    console.error(`❌ Manifest validation failed with ${errors} error(s)`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error validating manifest:', error.message);
  process.exit(1);
}

