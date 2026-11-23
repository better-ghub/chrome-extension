/**
 * @jest-environment node
 */

// Every message the popup / options / shared page code asks for must exist in
// BOTH locales, with the same placeholders — otherwise users see raw keys or
// "$1" in the UI.

import * as fs from 'fs';
import * as path from 'path';
import { SHORTCUT_DEFINITIONS } from '../src/shortcuts';

const ROOT = path.join(__dirname, '..');
type Messages = Record<string, { message: string }>;
const en = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/en/messages.json'), 'utf8')) as Messages;
const pl = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/pl/messages.json'), 'utf8')) as Messages;

function files(dir: string, ext: RegExp): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => ext.test(f))
    .map((f) => path.join(ROOT, dir, f));
}

const tsFiles = [...files('src/pages', /\.ts$/), ...files('popup', /\.ts$/), ...files('options', /\.ts$/)];
const htmlFiles = [...files('popup', /\.html$/), ...files('options', /\.html$/)];

function collectKeys(): { plain: Set<string>; plural: Set<string> } {
  const plain = new Set<string>();
  const pluralBases = new Set<string>();
  for (const file of tsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) plain.add(m[1]);
    for (const m of src.matchAll(/\bplural\(\s*'([A-Za-z0-9_]+)'/g)) pluralBases.add(m[1]);
  }
  for (const file of htmlFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) plain.add(m[1]);
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(',')) plain.add(pair.split(':')[1].trim());
    }
    for (const m of src.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) plain.add(m[1]);
  }
  for (const def of SHORTCUT_DEFINITIONS) plain.add(def.labelKey);
  return { plain, plural: pluralBases };
}

const placeholders = (s: string): string[] => [...s.matchAll(/\$(\d)/g)].map((m) => m[1]).sort();

describe('extension page messages', () => {
  const { plain, plural } = collectKeys();

  test('found the keys (sanity)', () => {
    expect(plain.size).toBeGreaterThan(150);
    expect(plural.size).toBeGreaterThanOrEqual(3);
  });

  test.each([...plain].sort())('%s exists in en and pl with matching placeholders', (key) => {
    expect(en[key]?.message).toBeTruthy();
    expect(pl[key]?.message).toBeTruthy();
    expect(placeholders(pl[key].message)).toEqual(placeholders(en[key].message));
  });

  test.each([...plural].sort())('plural %s has every CLDR form for each locale', (base) => {
    for (const form of ['one', 'other']) expect(en[`${base}_${form}`]?.message).toContain('$1');
    for (const form of ['one', 'few', 'many', 'other']) expect(pl[`${base}_${form}`]?.message).toContain('$1');
  });

  test('pages no longer reference Primer CSS or the old token code', () => {
    for (const file of [...htmlFiles, ...tsFiles]) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/primer\.css/);
      expect(src).not.toMatch(/src\/utils['"]/);
      expect(src).not.toMatch(/api\.github\.com\//);
      expect(src).not.toMatch(/githubToken/);
    }
  });

  test('no inline scripts or handlers (CSP: script-src self)', () => {
    for (const file of htmlFiles) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(src).not.toMatch(/\son[a-z]+\s*=/i);
    }
  });
});
