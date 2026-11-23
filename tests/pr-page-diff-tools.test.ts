import { currentMode, modeFromDom, otherMode, toggleWhitespaceHref, whitespaceHidden, withMode } from '../src/features/pr-page/diff-params-model';
import { matchPath, rankFiles } from '../src/features/pr-page/file-finder-model';
import { createFileFinder } from '../src/features/pr-page/file-finder';
import {
  changedSince,
  interpretCompare,
  parseVisits,
  pruneVisits,
  rangeFilesPath,
  recordVisit,
  relativeTime,
  visitKey,
  MAX_VISITS,
} from '../src/features/pr-page/visits-model';
import { defaultBindings, findDuplicates, SHORTCUT_ACTIONS } from '../src/shortcuts';

const FILES = 'https://github.com/o/r/pull/1/files';

describe('diff params', () => {
  test('whitespace toggles w=1 and keeps path and hash', () => {
    const on = toggleWhitespaceHref(`${FILES}?diff=split#diff-abc`);
    expect(on).toBe(`${FILES}?diff=split&w=1#diff-abc`);
    expect(whitespaceHidden(on)).toBe(true);
    expect(toggleWhitespaceHref(on)).toBe(`${FILES}?diff=split#diff-abc`);
  });

  test('split/unified: URL beats DOM, unknown → split', () => {
    document.body.innerHTML = '<table class="diff-table file-diff-split"></table>';
    expect(modeFromDom()).toBe('split');
    expect(currentMode(`${FILES}?diff=unified`)).toBe('unified');
    expect(currentMode(FILES)).toBe('split');
    document.body.innerHTML = '<table class="diff-table"></table>';
    expect(currentMode(FILES)).toBe('unified');
    document.body.innerHTML = '';
    expect(otherMode(currentMode(FILES))).toBe('split');
    expect(otherMode('split')).toBe('unified');
    expect(withMode(`${FILES}?w=1`, 'unified')).toBe(`${FILES}?w=1&diff=unified`);
  });
});

describe('file finder model', () => {
  const files = ['src/app/index.ts', 'src/components/Button.tsx', 'docs/button-guide.md', 'package-lock.json'].map((path) => ({ path, generated: false }));

  test('subsequence match and no-match', () => {
    expect(matchPath('sai', 'src/app/index.ts')).not.toBeNull();
    expect(matchPath('zzz', 'src/app/index.ts')).toBeNull();
    expect(matchPath('', 'a')).toEqual({ score: 0, positions: [] });
  });

  test('basename hits rank before directory hits', () => {
    const r = rankFiles('button', files).map((m) => m.file.path);
    expect(r[0]).toBe('src/components/Button.tsx');
    expect(r).toContain('docs/button-guide.md');
    expect(rankFiles('app', files)[0].file.path).toBe('src/app/index.ts');
  });

  test('empty query keeps diff order; positions point at matched chars', () => {
    expect(rankFiles('', files).map((m) => m.file.path)).toEqual(files.map((f) => f.path));
    const m = rankFiles('btn', files)[0];
    expect(m.positions.map((p) => m.file.path[p].toLowerCase()).join('')).toBe('btn');
  });
});

describe('file finder dialog', () => {
  function fixture(): void {
    document.body.innerHTML = ['a/one.ts', 'b/two.ts', 'package-lock.json']
      .map((p) => `<div class="js-file" data-tagsearch-path="${p}" id="f-${p.replace(/\W/g, '')}"><div class="file-header" data-path="${p}"></div></div>`)
      .join('');
  }
  const ctrl = new AbortController();
  beforeAll(() => {
    window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
  });
  afterAll(() => ctrl.abort());

  test('opens with files, filters, arrow keys move aria-activedescendant, Esc/close', () => {
    fixture();
    const finder = createFileFinder({ signal: ctrl.signal });
    expect(finder.open()).toBe(true);
    const input = document.querySelector<HTMLInputElement>('dialog[open] .bghub-ff-input') as HTMLInputElement;
    const options = (): Element[] => Array.from(document.querySelectorAll('dialog[open] [role="option"]'));
    expect(options()).toHaveLength(3);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(options().some((o) => o.querySelector('.bghub-ff-generated'))).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);

    input.value = 'two';
    input.dispatchEvent(new Event('input'));
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('two.ts');

    input.value = 'qqq';
    input.dispatchEvent(new Event('input'));
    expect(options()).toHaveLength(0);
    expect(document.querySelector<HTMLElement>('dialog[open] .bghub-ff-empty')?.hidden).toBe(false);
    finder.close();
    expect(finder.isOpen()).toBe(false);
  });

  test('Enter scrolls to the file and closes; no files → open() is false', async () => {
    fixture();
    const finder = createFileFinder({ signal: ctrl.signal });
    finder.open();
    const target = document.getElementById('f-btwots') as HTMLElement;
    const input = document.querySelector<HTMLInputElement>('dialog[open] .bghub-ff-input') as HTMLInputElement;
    input.value = 'two';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(finder.isOpen()).toBe(false);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(target.classList.contains('bghub-file-focus')).toBe(true);

    document.body.innerHTML = '';
    expect(finder.open()).toBe(false);
  });
});

describe('visits model', () => {
  const sha1 = 'a'.repeat(40);
  const sha2 = 'b'.repeat(40);

  test('parse drops junk; record prunes old and caps size', () => {
    expect(parseVisits({ x: { sha: sha1, at: 1 }, y: { sha: 5, at: 1 }, z: null })).toEqual({ x: { sha: sha1, at: 1 } });
    expect(parseVisits('nope')).toEqual({});
    const now = 200 * 86400000;
    expect(Object.keys(pruneVisits({ old: { sha: sha1, at: 1 }, fresh: { sha: sha1, at: now - 1000 } }, now))).toEqual(['fresh']);
    let m = {};
    for (let i = 0; i < MAX_VISITS + 20; i++) m = recordVisit(m, `k${i}`, sha1, now + i);
    expect(Object.keys(m)).toHaveLength(MAX_VISITS);
    expect(m).not.toHaveProperty('k0');
    expect(m).toHaveProperty(`k${MAX_VISITS + 19}`);
  });

  test('changedSince / keys / paths', () => {
    expect(changedSince({ sha: sha1, at: 1 }, sha2)).toEqual({ sha: sha1, at: 1 });
    expect(changedSince({ sha: sha1, at: 1 }, sha1.toUpperCase())).toBeNull();
    expect(changedSince(undefined, sha1)).toBeNull();
    expect(visitKey('O', 'R', 3)).toBe('o/r#3');
    expect(rangeFilesPath('o', 'r', 3, sha1, sha2)).toBe(`/o/r/pull/3/files/${'a'.repeat(12)}..${'b'.repeat(12)}`);
  });

  test('compare outcomes', () => {
    expect(interpretCompare({ status: 'ahead', total_commits: 3 })).toEqual({ kind: 'commits', count: 3 });
    expect(interpretCompare({ status: 'identical', total_commits: 0 })).toEqual({ kind: 'none' });
    expect(interpretCompare({ status: 'diverged', total_commits: 2 })).toEqual({ kind: 'rewritten' });
    expect(interpretCompare(null)).toEqual({ kind: 'rewritten' });
  });

  test('relative time', () => {
    const now = Date.now();
    expect(relativeTime(now - 2 * 3600000, now, 'en')).toBe('2 hours ago');
    expect(relativeTime(now - 3 * 86400000, now, 'en')).toBe('3 days ago');
    expect(relativeTime(now - 5000, now, 'en')).toMatch(/seconds? ago|now/);
  });
});

describe('registry', () => {
  test('new shortcuts are registered without clashes', () => {
    const b = defaultBindings();
    for (const a of ['toggleWhitespace', 'toggleSplitView', 'findFile', 'changesSinceVisit'] as const) {
      expect(SHORTCUT_ACTIONS).toContain(a);
      expect(findDuplicates(b, a)).toEqual([]);
    }
  });
});
