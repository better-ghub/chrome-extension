import { GENERATED_PATTERNS_DEFAULT } from '../src/core/settings';
import {
  checkoutCommandFor,
  isGeneratedPath,
  matchGenerated,
  MAX_PATTERNS,
  parsePatterns,
  samePatterns,
} from '../src/pages/generated';

describe('generated-file pattern matcher', () => {
  // [pattern, path, matches] — the contract the Files tab uses too.
  test.each([
    // No '/': the file name, at any depth.
    ['package-lock.json', 'package-lock.json', true],
    ['package-lock.json', 'apps/web/package-lock.json', true],
    ['package-lock.json', 'package-lock.json.bak', false],
    ['package-lock.json', 'my-package-lock.json', false],
    ['*.min.js', 'app.min.js', true],
    ['*.min.js', 'static/js/app.min.js', true],
    ['*.min.js', 'app.min.jsx', false],
    ['*.generated.*', 'src/api/types.generated.ts', true],
    ['*_pb2.py', 'proto/user_pb2.py', true],
    ['*.map', 'dist/app.js.map', true],
    // '.' is literal, not "any character".
    ['go.sum', 'goXsum', false],
    // '*' never crosses '/'.
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/deep/a.ts', false],
    // With '/': at any directory boundary.
    ['dist/**', 'dist/app.js', true],
    ['dist/**', 'packages/ui/dist/index.d.ts', true],
    ['dist/**', 'mydist/app.js', false],
    ['dist/**', 'src/distance.ts', false],
    ['__snapshots__/**', 'src/__snapshots__/App.test.tsx.snap', true],
    ['vendor/**', 'vendor/github.com/x/y.go', true],
    ['build/**', 'build', false],
    // '**' spans folders.
    ['docs/**/*.png', 'docs/img/a/b.png', true],
    // `**/` also matches zero folders (like .gitignore).
    ['docs/**/*.png', 'docs/b.png', true],
    // Leading '/': anchored at the repository root.
    ['/build/**', 'build/out.js', true],
    ['/build/**', 'packages/a/build/out.js', false],
    // Regex characters are literal.
    ['file(1).txt', 'file(1).txt', true],
    ['a+b.js', 'aab.js', false],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(isGeneratedPath(path, [pattern])).toBe(expected);
  });

  test('reports the first matching pattern; blank patterns are ignored', () => {
    expect(matchGenerated('web/dist/app.min.js', ['', '  ', '*.min.js', 'dist/**'])).toBe('*.min.js');
    expect(matchGenerated('src/app.ts', ['*.min.js'])).toBeNull();
    expect(matchGenerated('', ['*'])).toBeNull();
    expect(matchGenerated('a.js', ['   '])).toBeNull();
  });

  test('paths are trimmed and may start with ./ or /', () => {
    expect(isGeneratedPath(' ./dist/a.js ', ['dist/**'])).toBe(true);
    expect(isGeneratedPath('/yarn.lock', ['yarn.lock'])).toBe(true);
  });

  test('the defaults cover common generated files and leave source alone', () => {
    const defaults = [...GENERATED_PATTERNS_DEFAULT];
    for (const path of ['package-lock.json', 'pnpm-lock.yaml', 'go.sum', 'web/app.min.css', 'src/__snapshots__/x.snap', 'api/user.pb.go']) {
      expect(isGeneratedPath(path, defaults)).toBe(true);
    }
    for (const path of ['src/index.ts', 'README.md', 'package.json', 'src/build.ts']) {
      expect(isGeneratedPath(path, defaults)).toBe(false);
    }
  });
});

describe('pattern list editing', () => {
  test('one per line, trimmed, blanks and duplicates dropped', () => {
    expect(parsePatterns('  dist/**\n\n*.map\r\n*.map\n   \nyarn.lock  ')).toEqual(['dist/**', '*.map', 'yarn.lock']);
    expect(parsePatterns('')).toEqual([]);
  });

  test('caps the count and skips over-long patterns', () => {
    const many = Array.from({ length: 150 }, (_, i) => `f${i}.txt`).join('\n');
    expect(parsePatterns(many)).toHaveLength(MAX_PATTERNS);
    expect(parsePatterns(`${'a'.repeat(201)}\nok`)).toEqual(['ok']);
  });

  test('samePatterns compares order and content', () => {
    expect(samePatterns(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(samePatterns(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(samePatterns(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('checkout command preview', () => {
  test.each([
    ['gh', 123, 'gh pr checkout 123'],
    ['git', 123, 'git fetch origin pull/123/head:pr-123 && git switch pr-123'],
    ['git', 7, 'git fetch origin pull/7/head:pr-7 && git switch pr-7'],
  ] as const)('%s #%d', (kind, n, expected) => {
    expect(checkoutCommandFor(kind, n)).toBe(expected);
  });
});
