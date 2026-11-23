/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://github.com/o/r/pull/1/files"}
 */

import { parsePage } from '../src/core/page';
import { GENERATED_PATTERNS_DEFAULT } from '../src/core/settings';
import { createReviewNavigator, runAction, type ActionContext } from '../src/features/pr-page/actions';
import { checkoutCommand, copyCheckout } from '../src/features/pr-page/actions/checkout';
import { collectGeneratedToggles } from '../src/features/pr-page/actions/generated';
import { basename, cleanPath, collectDiffFiles } from '../src/features/pr-page/files-model';
import { diffKey, watchFilesTab } from '../src/features/pr-page/files-tab';
import { startAutoCollapse } from '../src/features/pr-page/generated';
import { compilePatterns, matchesGenerated } from '../src/core/generated-patterns';
import { prPageFeature } from '../src/features/pr-page';
import { countViewed, mountProgress } from '../src/features/pr-page/progress';
import { pickCurrentIndex, pickNextUnviewed, progressCounts } from '../src/features/pr-page/progress-model';
import { buildThreadItems, excerpt, EXCERPT_LENGTH } from '../src/features/pr-page/threads-model';
import { createThreadsPanel } from '../src/features/pr-page/threads-panel';

const PR = 'https://github.com/o/r/pull/1';
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeCtx(url = `${PR}/files`): ActionContext & { show: jest.Mock } {
  const show = jest.fn();
  return {
    page: parsePage(url),
    binding: null,
    toasts: { show },
    threads: { step: jest.fn(), reveal: jest.fn() },
    review: { markViewedNext: jest.fn(), nextUnviewed: jest.fn() },
    toggleHelp: jest.fn(),
    toggleThreadsPanel: jest.fn(),
    show,
  };
}

/** Classic Files-tab file, as GitHub renders it for a logged-in (viewed checkbox) or logged-out user. */
function file(path: string, { open = true, viewed = false as boolean | null } = {}): string {
  const id = `f-${path.replace(/\W/g, '-')}`;
  const checkbox = viewed === null ? '' : `<form><label><input type="checkbox" name="viewed" class="js-reviewed-checkbox"${viewed ? ' checked' : ''}> Viewed</label></form>`;
  return `<div id="${id}" class="file js-file js-details-container Details${open ? ' open Details--on' : ''}" data-tagsearch-path="${path}">
    <div class="file-header" data-path="${path}">
      <div class="file-info"><button class="btn-octicon js-details-target" aria-label="Toggle diff contents" aria-expanded="${open}"></button>
        <a title="${path}" class="Link--primary" href="#diff-${id}">${path}</a></div>
      <div class="file-actions">${checkbox}</div>
    </div>
    <div class="js-file-content"></div>
  </div>`;
}

let wired = new AbortController();

/** Simulate GitHub's chevron handler on every file (also for files added later). */
function wireFiles(): string[] {
  const clicked: string[] = [];
  document.body.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('button.js-details-target');
    const f = btn?.closest('.js-file');
    if (!btn || !f) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    clicked.push(f.getAttribute('data-tagsearch-path') ?? '');
    btn.setAttribute('aria-expanded', String(open));
    f.classList.toggle('open', open);
    f.classList.toggle('Details--on', open);
  }, { signal: wired.signal });
  return clicked;
}

const isOpen = (path: string): boolean => document.querySelector(`[data-tagsearch-path="${path}"] .js-details-target`)?.getAttribute('aria-expanded') === 'true';

/** jsdom has no layout: give a file a viewport position. */
function place(path: string, top: number, height = 400): void {
  const el = document.querySelector(`[data-tagsearch-path="${path}"]`) as HTMLElement;
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  el.getClientRects = () => [{}] as unknown as DOMRectList;
}

beforeEach(() => {
  wired.abort();
  wired = new AbortController();
  document.body.innerHTML = '';
  // Our floating UI lives on <html>; drop leftovers whose exit timers haven't fired yet.
  document.documentElement.querySelectorAll(':scope > [data-bghub]').forEach((n) => n.remove());
  window.scrollTo = jest.fn();
});

describe('generated-file patterns', () => {
  const defaults = GENERATED_PATTERNS_DEFAULT;
  test.each([
    ['package-lock.json', true],
    ['web/app/package-lock.json', true],
    ['crates/core/Cargo.lock', true],
    ['go.sum', true],
    ['dist/index.js', true],
    ['packages/ui/dist/a/b.js', true],
    ['static/vendor.min.js', true],
    ['styles/app.min.css', true],
    ['src/__snapshots__/app.test.ts.snap', true],
    ['__snapshots__/x.txt', true],
    ['src/core/icons.generated.ts', true],
    ['api/v1/user_pb2.py', true],
    ['src/distribution.ts', false],
    ['build.ts', false],
    ['src/build.ts', false],
    ['mydist/a.js', false],
    ['src/dist.ts', false],
    ['package.json', false],
    ['yarn.lock.md', false],
    ['min.js', false],
    ['lib/vendored.ts', false],
    ['gemfile.lock', false], // case-sensitive, like git
  ])('%s → %s', (path, expected) => {
    expect(matchesGenerated(path, defaults)).toBe(expected);
  });

  test('anchors, trailing slashes, **/ and literal special characters', () => {
    expect(matchesGenerated('dist/a.js', ['/dist/**'])).toBe(true);
    expect(matchesGenerated('pkg/dist/a.js', ['/dist/**'])).toBe(false);
    expect(matchesGenerated('docs/a/b.md', ['docs/'])).toBe(true);
    expect(matchesGenerated('x/docs/b.md', ['docs/'])).toBe(true);
    expect(matchesGenerated('fixtures/a.json', ['**/fixtures/*.json'])).toBe(true);
    expect(matchesGenerated('test/fixtures/a.json', ['**/fixtures/*.json'])).toBe(true);
    expect(matchesGenerated('test/fixtures/sub/a.json', ['**/fixtures/*.json'])).toBe(false);
    expect(matchesGenerated('a/b.txt', ['a/**/b.txt'])).toBe(true);
    expect(matchesGenerated('a/x/y/b.txt', ['a/**/b.txt'])).toBe(true);
    expect(matchesGenerated('ab.js', ['a?.js'])).toBe(false);
    expect(matchesGenerated('file(1).txt', ['file(1).txt'])).toBe(true);
  });

  test('empty / blank lists match nothing; compiled once per list', () => {
    expect(matchesGenerated('yarn.lock', [])).toBe(false);
    expect(matchesGenerated('yarn.lock', ['  ', ''])).toBe(false);
    expect(compilePatterns([' '])).toBeNull();
    expect(matchesGenerated('', defaults)).toBe(false);
    const list = ['*.lock'];
    expect(matchesGenerated('a/b.lock', list)).toBe(true);
    expect(matchesGenerated('a/b.lock', [...list])).toBe(true); // equal list, new array
  });

  test('path cleanup', () => {
    expect(cleanPath('‎src/a.ts‎')).toBe('src/a.ts');
    expect(cleanPath('old/name.ts → new/name.ts')).toBe('new/name.ts');
    expect(basename('a/b/c.min.js')).toBe('c.min.js');
  });
});

describe('auto-collapse generated files', () => {
  const opts = (signal: AbortSignal, pageKey: string, show = jest.fn()) => ({
    signal,
    pageKey,
    toasts: { show },
    patterns: GENERATED_PATTERNS_DEFAULT,
    binding: () => null,
    expandAll: jest.fn(),
  });

  test('collapses each generated file once, tags it, and never fights a re-expanded one', async () => {
    document.body.innerHTML = file('package-lock.json') + file('src/app.ts') + file('dist/x.js') + file('yarn.lock', { open: false });
    const clicked = wireFiles();
    const first = new AbortController();
    const run = startAutoCollapse(opts(first.signal, 'k-once'));

    expect(clicked).toEqual(['package-lock.json', 'dist/x.js']);
    expect(isOpen('src/app.ts')).toBe(true);
    expect(document.querySelectorAll('.bghub-gen-chip')).toHaveLength(3);
    expect(document.querySelector('[data-path="dist/x.js"] .file-info .bghub-gen-chip')?.textContent).toContain('Generated');

    // The user re-expands one; GitHub lazy-loads another batch.
    (document.querySelector('[data-path="package-lock.json"] .js-details-target') as HTMLElement).click();
    document.body.insertAdjacentHTML('beforeend', file('vendor/lib.js'));
    run.scan();
    expect(isOpen('package-lock.json')).toBe(true);
    expect(isOpen('vendor/lib.js')).toBe(false);
    expect(clicked.filter((p) => p === 'package-lock.json')).toHaveLength(2); // the user's click only

    // Settings remount (same task): state is kept, chips come back.
    first.abort();
    const second = new AbortController();
    startAutoCollapse(opts(second.signal, 'k-once'));
    expect(isOpen('package-lock.json')).toBe(true);
    expect(document.querySelectorAll('.bghub-gen-chip')).toHaveLength(4);

    // Leaving the page drops the state: coming back collapses again.
    second.abort();
    expect(document.querySelectorAll('.bghub-gen-chip')).toHaveLength(0);
    await flush();
    const third = new AbortController();
    startAutoCollapse(opts(third.signal, 'k-once'));
    expect(isOpen('package-lock.json')).toBe(false);
    third.abort();
    await flush();
  });

  test('one toast per page load, counting lazily loaded files, with an Expand action', () => {
    jest.useFakeTimers();
    try {
      document.body.innerHTML = file('a/yarn.lock') + file('b/yarn.lock');
      wireFiles();
      const show = jest.fn();
      const controller = new AbortController();
      const run = startAutoCollapse(opts(controller.signal, 'k-toast', show));
      jest.advanceTimersByTime(300);
      document.body.insertAdjacentHTML('beforeend', file('c/yarn.lock'));
      run.scan();
      jest.advanceTimersByTime(800);
      expect(show).toHaveBeenCalledTimes(1);
      expect(show).toHaveBeenCalledWith('Collapsed 3 generated files', expect.objectContaining({ id: 'generated', action: expect.objectContaining({ label: 'Expand' }) }));
      document.body.insertAdjacentHTML('beforeend', file('d/yarn.lock'));
      run.scan();
      jest.advanceTimersByTime(2000);
      expect(show).toHaveBeenCalledTimes(1);
      controller.abort();
      jest.runAllTicks();
    } finally {
      jest.useRealTimers();
    }
  });

  test('toggleGenerated converges (any expanded → collapse all, else expand all)', () => {
    document.body.innerHTML = file('pnpm-lock.yaml') + file('src/a.ts') + file('x.snap', { open: false });
    const clicked = wireFiles();
    const ctx = makeCtx();
    expect(collectGeneratedToggles(document, GENERATED_PATTERNS_DEFAULT)).toHaveLength(2);
    runAction('toggleGenerated', ctx);
    expect(clicked).toEqual(['pnpm-lock.yaml']);
    expect(ctx.show).toHaveBeenLastCalledWith('Generated files collapsed (1)', expect.objectContaining({ icon: 'fold' }));
    runAction('toggleGenerated', ctx);
    expect(clicked).toEqual(['pnpm-lock.yaml', 'pnpm-lock.yaml', 'x.snap']);
    expect(ctx.show).toHaveBeenLastCalledWith('Generated files expanded (2)', expect.anything());
    expect(isOpen('src/a.ts')).toBe(true);

    document.body.innerHTML = file('src/only.ts');
    runAction('toggleGenerated', ctx);
    expect(ctx.show).toHaveBeenLastCalledWith('No generated files in this diff', expect.objectContaining({ variant: 'info' }));
  });
});

describe('review progress model', () => {
  test('counts only files that have a Viewed control', () => {
    expect(progressCounts([{ viewed: true }, { viewed: false }, { viewed: null }, { viewed: true, hidden: true }])).toEqual({ viewed: 2, total: 3 });
    document.body.innerHTML = file('a.ts', { viewed: true }) + file('b.ts') + file('c.ts', { viewed: null });
    expect(countViewed()).toEqual({ viewed: 1, total: 2 });
    expect(collectDiffFiles().map((f) => [f.path, f.viewed?.checked ?? null])).toEqual([
      ['a.ts', true],
      ['b.ts', false],
      ['c.ts', null],
    ]);
  });

  test('current file: header in the top third and body still below the sticky line', () => {
    const vh = 900; // top third = 300
    const line = 120;
    expect(pickCurrentIndex([{ top: -800, bottom: -100 }, { top: -100, bottom: 500 }, { top: 500, bottom: 1500 }], vh, line)).toBe(1);
    expect(pickCurrentIndex([{ top: 50, bottom: 90 }, { top: 90, bottom: 900 }], vh, line)).toBe(1); // collapsed file under the sticky chrome
    expect(pickCurrentIndex([{ top: 400, bottom: 900 }, { top: 900, bottom: 1200 }], vh, line)).toBe(0); // top of the page
    expect(pickCurrentIndex([{ top: 0, bottom: 0, hidden: true }, { top: 200, bottom: 600 }], vh, line)).toBe(1);
    expect(pickCurrentIndex([{ top: -500, bottom: -100 }], vh, line)).toBe(-1);
  });

  test('next unviewed: after the current file, wrapping, skipping hidden files, current last', () => {
    const s = (...v: (boolean | null | 'h')[]) => v.map((x) => (x === 'h' ? { viewed: false, hidden: true } : { viewed: x }));
    expect(pickNextUnviewed(s(true, false, true, false, null), 1)).toBe(3);
    expect(pickNextUnviewed(s(true, false, true, false, null), 3)).toBe(1);
    expect(pickNextUnviewed(s(true, false, true, false), -1)).toBe(1);
    expect(pickNextUnviewed(s(true, 'h', false), 0)).toBe(2);
    expect(pickNextUnviewed(s(true, false), 1)).toBe(1);
    expect(pickNextUnviewed(s(true, true, null), 0)).toBe(-1);
  });
});

describe('mark viewed & next / next unviewed', () => {
  // jsdom: innerHeight 768 → top third 256, jumpOffset() 154.
  function setup(): void {
    document.body.innerHTML = file('src/a.ts') + file('src/b.ts', { viewed: true }) + file('src/c.ts', { open: false }) + file('src/d.ts');
    wireFiles();
    place('src/a.ts', 100, 400);
    place('src/b.ts', 500, 400);
    place('src/c.ts', 900, 40);
    place('src/d.ts', 940, 400);
  }
  const checked = (path: string): boolean => (document.querySelector(`[data-path="${path}"] input`) as HTMLInputElement).checked;

  test('Alt+V ticks the current file, then jumps to (and expands) the next unviewed one', async () => {
    setup();
    const controller = new AbortController();
    const ctx = { ...makeCtx(), review: createReviewNavigator(controller.signal) };
    runAction('markViewedNext', ctx);
    expect(checked('src/a.ts')).toBe(true);
    expect(isOpen('src/c.ts')).toBe(true);
    expect(ctx.show).toHaveBeenLastCalledWith('Marked a.ts as viewed · 2/4', expect.objectContaining({ id: 'review' }));
    await nextFrame();
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.querySelector('[data-path="src/c.ts"]')?.classList.contains('bghub-file-focus')).toBe(true);
    expect(document.activeElement?.getAttribute('href')).toBe('#diff-f-src-c-ts');

    // Rapid second press acts on the file we just jumped to, not on scroll position.
    runAction('markViewedNext', ctx);
    expect(checked('src/c.ts')).toBe(true);
    expect(ctx.show).toHaveBeenLastCalledWith('Marked c.ts as viewed · 3/4', expect.anything());
    runAction('markViewedNext', ctx);
    expect(ctx.show).toHaveBeenLastCalledWith('All 4 files viewed', expect.objectContaining({ icon: 'sparkle-fill' }));
    controller.abort();
  });

  test('Alt+V on an already-viewed file just advances', () => {
    setup();
    place('src/a.ts', -600, 400); // scrolled past a.ts; b.ts (viewed) is current
    place('src/b.ts', 0, 400);
    const ctx = { ...makeCtx(), review: createReviewNavigator(new AbortController().signal) };
    runAction('markViewedNext', ctx);
    expect(checked('src/b.ts')).toBe(true);
    expect(checked('src/c.ts')).toBe(false);
    expect(ctx.show).toHaveBeenLastCalledWith('Next unviewed: c.ts · 3 left', expect.anything());
  });

  test('Alt+N: next unviewed after the scroll position, wrapping around', () => {
    setup();
    place('src/a.ts', -1000, 400);
    place('src/b.ts', -600, 400);
    place('src/c.ts', -200, 40);
    place('src/d.ts', -160, 600); // reading d.ts → wraps to a.ts
    const ctx = { ...makeCtx(), review: createReviewNavigator(new AbortController().signal) };
    runAction('nextUnviewed', ctx);
    expect(ctx.show).toHaveBeenLastCalledWith('Next unviewed: a.ts · 3 left', expect.objectContaining({ variant: 'info' }));
  });

  test('top of the page: the first file on screen counts as "after" the scroll position', () => {
    setup();
    place('src/a.ts', 400, 400);
    const ctx = { ...makeCtx(), review: createReviewNavigator(new AbortController().signal) };
    runAction('nextUnviewed', ctx);
    expect(ctx.show).toHaveBeenLastCalledWith('Next unviewed: a.ts · 3 left', expect.anything());
  });

  test('logged out (no Viewed checkboxes) → explains, touches nothing', () => {
    document.body.innerHTML = file('a.ts', { viewed: null });
    const ctx = { ...makeCtx(), review: createReviewNavigator(new AbortController().signal) };
    runAction('markViewedNext', ctx);
    runAction('nextUnviewed', ctx);
    expect(ctx.show.mock.calls.map((c) => c[0])).toEqual(['Sign in to GitHub to mark files as viewed', 'Sign in to GitHub to mark files as viewed']);
  });

  test('outside the Files tab → scope toast', () => {
    const ctx = makeCtx(PR);
    runAction('markViewedNext', ctx);
    expect(ctx.review.markViewedNext).not.toHaveBeenCalled();
    expect(ctx.show.mock.calls[0][0]).toContain('works on the Files changed tab');
  });
});

describe('progress pill', () => {
  test('shows counts, updates live on checkbox changes, celebrates completion once', async () => {
    document.body.innerHTML = file('a.ts', { viewed: true }) + file('b.ts');
    const controller = new AbortController();
    const onComplete = jest.fn();
    const onNext = jest.fn();
    mountProgress({ signal: controller.signal, onNext, onComplete, binding: () => null });
    const pill = document.querySelector('.bghub-progress') as HTMLElement;
    expect(pill.getAttribute('role')).toBe('group');
    expect(pill.textContent).toContain('1 / 2 files viewed');
    expect(pill.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
    expect((pill.querySelector('.bghub-progress-fill') as HTMLElement).style.transform).toBe('scaleX(0.5)');
    (pill.querySelector('.bghub-progress-next') as HTMLButtonElement).click();
    expect(onNext).toHaveBeenCalledTimes(1);

    (document.querySelector('[data-path="b.ts"] input') as HTMLInputElement).click();
    await nextFrame();
    expect(pill.textContent).toContain('All 2 files viewed');
    expect(pill.classList.contains('bghub-progress--done')).toBe(true);
    expect((pill.querySelector('.bghub-progress-next') as HTMLButtonElement).hidden).toBe(true);
    expect(onComplete).toHaveBeenCalledWith(2);
    controller.abort();
  });

  test('a fully viewed page does not celebrate on load; no pill without Viewed controls', () => {
    document.body.innerHTML = file('a.ts', { viewed: true });
    const onComplete = jest.fn();
    const one = new AbortController();
    mountProgress({ signal: one.signal, onNext: jest.fn(), onComplete, binding: () => null });
    expect(document.querySelector('.bghub-progress')?.textContent).toContain('1 file viewed');
    expect(onComplete).not.toHaveBeenCalled();
    one.abort();

    document.documentElement.querySelectorAll(':scope > .bghub-progress').forEach((n) => n.remove());
    document.body.innerHTML = file('a.ts', { viewed: null });
    const two = new AbortController();
    mountProgress({ signal: two.signal, onNext: jest.fn(), onComplete, binding: () => null });
    expect(document.querySelector('.bghub-progress')).toBeNull();
    two.abort();
  });

  test('feature mount on the Files tab wires auto-collapse and the pill', async () => {
    document.body.innerHTML = file('yarn.lock') + file('src/a.ts');
    wireFiles();
    const controller = new AbortController();
    void prPageFeature.mount({ page: parsePage(`${PR}/files`), signal: controller.signal });
    expect(isOpen('yarn.lock')).toBe(false);
    expect(isOpen('src/a.ts')).toBe(true);
    expect(document.querySelector('.bghub-progress')?.textContent).toContain('0 / 2 files viewed');
    controller.abort();
    await flush();
    expect(document.querySelector('.bghub-gen-chip')).toBeNull();
  });
});

describe('unresolved threads panel', () => {
  const long = 'Could we memoize this selector? '.repeat(8);
  const fixture = `
    <review-thread-collapsible id="t1" class="review-thread-component" data-resolved="false">
      <a class="Link--primary text-mono" href="#r1">src/components/very/deep/Button.tsx</a>
      <span class="Label Label--attention">Outdated</span>
      <img class="avatar" src="https://avatars.githubusercontent.com/u/1?s=40" alt="@mona"><a class="author">mona</a>
      <div class="comment-body markdown-body"><p>${long}</p><span class="Label">Outdated</span></div>
    </review-thread-collapsible>
    <review-thread-collapsible id="t2" class="review-thread-component" data-resolved="true"></review-thread-collapsible>
    <div class="file js-file" data-tagsearch-path="lib/x.ts"><div class="file-header" data-path="lib/x.ts"></div>
      <table><tbody><tr class="js-inline-comments-container"><td>
        <div id="t3" class="review-thread-component" data-resolved="false">
          <img class="avatar" src="http://evil.example/a.png"><a class="author">@octocat</a>
          <div class="comment-body"><p>  Nit:   rename   </p></div>
        </div></td></tr></tbody></table></div>`;

  test('model: path, excerpt, author, https-only avatar, outdated', () => {
    document.body.innerHTML = fixture;
    const items = buildThreadItems(document);
    expect(items.map((i) => i.el.id)).toEqual(['t1', 't3']);
    const [a, b] = items;
    expect(a.path).toBe('src/components/very/deep/Button.tsx');
    expect(a.excerpt.length).toBeLessThanOrEqual(EXCERPT_LENGTH);
    expect(a.excerpt.endsWith('…')).toBe(true);
    expect(a.author).toBe('mona');
    expect(a.avatar).toBe('https://avatars.githubusercontent.com/u/1?s=40');
    expect(a.outdated).toBe(true);
    expect(b).toEqual(expect.objectContaining({ path: 'lib/x.ts', excerpt: 'Nit: rename', author: 'octocat', avatar: null, outdated: false }));
    expect(excerpt('short')).toBe('short');
    expect(excerpt('x'.repeat(300))).toHaveLength(EXCERPT_LENGTH);
  });

  test('opens with focus on the first item, arrows move, click jumps, Esc closes and restores focus', () => {
    document.body.innerHTML = `<button id="before">before</button>${fixture}`;
    (document.getElementById('before') as HTMLButtonElement).focus();
    const reveal = jest.fn();
    const controller = new AbortController();
    const panel = createThreadsPanel({ signal: controller.signal, reveal });
    panel.toggle();
    const el = document.querySelector('.bghub-tp') as HTMLElement;
    expect(panel.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    expect(el.querySelector('.bghub-tp-count')?.textContent).toBe('2');
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('.bghub-tp-item'));
    expect(items.map((b) => b.querySelector('.bghub-tp-path')?.textContent)).toEqual(['src/components/very/deep/Button.tsx', 'lib/x.ts']);
    expect(items[0].querySelector('.bghub-tp-outdated')).not.toBeNull();
    expect(items[1].querySelector('img')).toBeNull(); // http:// avatar dropped
    expect(document.activeElement).toBe(items[0]);

    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].tabIndex).toBe(0);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]); // wraps

    items[1].click();
    expect(reveal).toHaveBeenCalledWith(document.getElementById('t3'));
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(panel.isOpen()).toBe(true); // stays open

    items[1].focus();
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
    expect(document.activeElement?.id).toBe('before');
    controller.abort();
  });

  test('rebuilds while open when a thread gets resolved; empty state', async () => {
    document.body.innerHTML = fixture;
    const controller = new AbortController();
    const panel = createThreadsPanel({ signal: controller.signal, reveal: jest.fn() });
    panel.open();
    document.getElementById('t1')?.setAttribute('data-resolved', 'true');
    await sleep(200);
    expect(document.querySelectorAll('.bghub-tp-item')).toHaveLength(1);
    expect(document.activeElement?.classList.contains('bghub-tp-item')).toBe(true); // focus kept in the list
    document.getElementById('t3')?.setAttribute('data-resolved', 'true');
    await sleep(200);
    expect(document.querySelector('.bghub-tp-empty')?.textContent).toBe('No unresolved threads');
    controller.abort();
    expect(panel.isOpen()).toBe(false);
  });
});

describe('copy checkout command', () => {
  test('command strings', () => {
    expect(checkoutCommand(42, 'gh')).toBe('gh pr checkout 42');
    expect(checkoutCommand(42, 'git')).toBe('git fetch origin pull/42/head:pr-42 && git switch pr-42');
  });

  test('copies and shows the command', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const ctx = makeCtx(PR);
    await copyCheckout(ctx, 'git');
    expect(writeText).toHaveBeenCalledWith('git fetch origin pull/1/head:pr-1 && git switch pr-1');
    expect(ctx.show).toHaveBeenCalledWith('Copied checkout command', expect.objectContaining({ code: 'git fetch origin pull/1/head:pr-1 && git switch pr-1', icon: 'terminal' }));
  });
});

describe('diff view lifecycle', () => {
  test('diffKey recognises every diff view of a PR', () => {
    expect(diffKey(`${PR}/files`)).toBe('/o/r/pull/1/files');
    expect(diffKey(`${PR}/changes?w=1`)).toBe('/o/r/pull/1/changes?w=1');
    expect(diffKey(`${PR}/commits/abc123`)).toBe('/o/r/pull/1/commits/abc123');
    expect(diffKey(PR)).toBeNull();
    expect(diffKey(`${PR}/commits`)).toBeNull();
  });

  test('starts on the Files tab and aborts when the reader leaves it', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    watchFilesTab(controller.signal, (s) => signals.push(s));
    expect(signals).toHaveLength(1);
    history.pushState({}, '', '/o/r/pull/1');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await nextFrame();
    expect(signals[0].aborted).toBe(true);
    history.pushState({}, '', '/o/r/pull/1/files');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await nextFrame();
    expect(signals).toHaveLength(2);
    controller.abort();
    expect(signals[1].aborted).toBe(true);
  });
});
