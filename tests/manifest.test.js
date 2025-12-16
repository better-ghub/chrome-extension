/**
 * @jest-environment node
 */

const manifest = require('../manifest.json');

describe('Manifest Validation', () => {
  test('should have manifest_version 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test('should have name defined', () => {
    expect(manifest.name).toBeDefined();
    expect(typeof manifest.name).toBe('string');
  });

  test('should have version in correct format', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('should have description', () => {
    expect(manifest.description).toBeDefined();
  });

  test('should have required icons', () => {
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons['16']).toBeDefined();
    expect(manifest.icons['48']).toBeDefined();
    expect(manifest.icons['128']).toBeDefined();
  });

  test('should have content_scripts defined', () => {
    expect(manifest.content_scripts).toBeDefined();
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
  });

  test('content_scripts should have GitHub matches', () => {
    const hasGitHubMatch = manifest.content_scripts.some(script =>
      script.matches.some(match => match.includes('github.com'))
    );
    expect(hasGitHubMatch).toBe(true);
  });

  test('should have permissions array', () => {
    expect(manifest.permissions).toBeDefined();
    expect(Array.isArray(manifest.permissions)).toBe(true);
  });

  test('should have storage permission', () => {
    expect(manifest.permissions).toContain('storage');
  });

  test('should have host_permissions for GitHub', () => {
    expect(manifest.host_permissions).toBeDefined();
    expect(manifest.host_permissions.some(p => p.includes('github.com'))).toBe(true);
    expect(manifest.host_permissions.some(p => p.includes('api.github.com'))).toBe(true);
  });

  test('should have background service worker', () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBeDefined();
  });

  test('should have action with popup', () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBeDefined();
  });

  test('version should match package.json', () => {
    const fs = require('fs');
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    expect(manifest.version).toBe(packageJson.version);
  });
});

