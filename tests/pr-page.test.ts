import { parsePage } from '../src/core/page';
import { defaultBindings, SHORTCUT_DEFINITIONS, type ShortcutAction, type ShortcutBinding } from '../src/shortcuts';
import { applyTarget, normalizeToggles, targetExpanded, type Toggle } from '../src/features/pr-page/toggle-state';
import { collectCommentToggles, collectFileToggles } from '../src/features/pr-page/toggles';
import { collectUnresolvedThreads, isResolved, pickThreadIndex } from '../src/features/pr-page/actions/threads';
import { createThreadNavigator, runAction, type ActionContext } from '../src/features/pr-page/actions';
import { findTabLink, isOnTab, tabPaths } from '../src/features/pr-page/actions/goto';
import {
  cleanTitle,
  findHeadRef,
  findTitle,
  headRefFromApi,
  markdownLink,
  parseHeadRef,
  titleFromDocumentTitle,
} from '../src/features/pr-page/pr-info';
import { installKeyboard } from '../src/features/pr-page/keyboard';
import { attachToaster, _toastElements } from '../src/features/pr-page/toast';
import { createCheatsheet, renderGroups } from '../src/features/pr-page/cheatsheet';
import { beginVisit } from '../src/features/pr-page/session';
import { prPageFeature } from '../src/features/pr-page';

const PR = 'https://github.com/o/r/pull/1';
const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

function fixture(markup: string): void {
  document.body.innerHTML = markup;
}

function makeCtx(url = PR): ActionContext & { show: jest.Mock } {
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

/** Simulate GitHub's own handlers: buttons flip aria-expanded + the owner's open class. */
function wireToggleButtons(ownerSelector: string, buttonSelector: string, classes = ['open']): string[] {
  const clicked: string[] = [];
  document.querySelectorAll<HTMLElement>(ownerSelector).forEach((owner) => {
    owner.querySelector(buttonSelector)?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLElement;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      clicked.push(owner.id);
      btn.setAttribute('aria-expanded', String(open));
      for (const c of classes) owner.classList.toggle(c, open);
    });
  });
  return clicked;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.querySelectorAll(':scope > [data-bghub]').forEach((n) => n.remove());
  window.scrollTo = jest.fn();
});

describe('target state', () => {
  const item = (expanded: boolean, nested = false): Toggle => ({ el: document.createElement('div'), expanded, nested, set: jest.fn() });

  test('any expanded → collapse all; none expanded → expand all', () => {
    expect(targetExpanded([item(false), item(false)])).toBe(true);
    expect(targetExpanded([item(true), item(false)])).toBe(false);
    expect(targetExpanded([item(true), item(true)])).toBe(false);
    expect(targetExpanded([])).toBe(true);
  });

  test('nested items do not vote', () => {
    expect(targetExpanded([item(false), item(true, true)])).toBe(true);
    expect(targetExpanded([item(true, true)])).toBe(false);
  });

  test('applyTarget only touches items whose state differs', () => {
    const items = [item(true), item(false), item(true)];
    expect(applyTarget(items, false)).toBe(2);
    expect(items[0].set).toHaveBeenCalledWith(false);
    expect(items[1].set).not.toHaveBeenCalled();
    expect(items[2].set).toHaveBeenCalledWith(false);
  });

  test('normalizeToggles de-duplicates and flags nesting', () => {
    const outer = document.createElement('div');
    const inner = outer.appendChild(document.createElement('div'));
    const list = normalizeToggles([
      { el: outer, expanded: false, set: jest.fn() },
      { el: inner, expanded: true, set: jest.fn() },
      { el: inner, expanded: true, set: jest.fn() },
    ]);
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.nested)).toEqual([false, true]);
  });
});

describe('toggleComments — conversation tab', () => {
  const thread = (id: string, open: boolean, resolved = false): string =>
    `<review-thread-collapsible id="${id}" class="review-thread-component js-resolvable-timeline-thread-container${open ? ' open' : ''}" data-resolved="${resolved}">
      <button data-target="review-thread-collapsible.button" aria-expanded="${open}">toggle</button>
    </review-thread-collapsible>`;

  test('review-thread-collapsible: clicks only the threads that differ', () => {
    fixture(`${thread('t1', true)}${thread('t2', false, true)}${thread('t3', true)}
      <div class="markdown-body"><details id="bot" class="review-thread-component" open><summary>Bot summary</summary></details></div>`);
    const clicked = wireToggleButtons('review-thread-collapsible', 'button');
    const ctx = makeCtx();

    expect(collectCommentToggles(document, 'conversation')).toHaveLength(3);
    runAction('toggleComments', ctx);
    expect(clicked).toEqual(['t1', 't3']);
    expect(ctx.show).toHaveBeenLastCalledWith('Review threads collapsed (2)', expect.objectContaining({ icon: 'fold' }));

    runAction('toggleComments', ctx);
    expect(clicked).toEqual(['t1', 't3', 't1', 't2', 't3']);
    expect(ctx.show).toHaveBeenLastCalledWith('Review threads expanded (3)', expect.anything());
    // Bot summary <details> inside .markdown-body is never touched.
    expect((document.getElementById('bot') as HTMLDetailsElement).open).toBe(true);
  });

  test('legacy <details> threads and outdated wrappers', () => {
    fixture(`
      <details id="d1" class="js-resolvable-timeline-thread-container" open></details>
      <details id="d2" class="outdated-diff-comment-container"></details>
      <details id="d3" class="review-thread-component" open></details>`);
    runAction('toggleComments', makeCtx());
    expect(['d1', 'd2', 'd3'].map((id) => (document.getElementById(id) as HTMLDetailsElement).open)).toEqual([false, false, false]);
    runAction('toggleComments', makeCtx());
    expect(['d1', 'd2', 'd3'].map((id) => (document.getElementById(id) as HTMLDetailsElement).open)).toEqual([true, true, true]);
  });

  test('an open thread hidden inside a collapsed wrapper does not flip the vote', () => {
    fixture(`<details id="wrap" class="outdated-diff-comment-container">
      <details id="inner" class="js-resolvable-timeline-thread-container" open></details></details>`);
    runAction('toggleComments', makeCtx());
    expect((document.getElementById('wrap') as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById('inner') as HTMLDetailsElement).open).toBe(true);
  });

  test('React threads: aria-expanded or the button label decides the state', () => {
    fixture(`
      <div id="r1" data-testid="review-thread"><button data-is-first-collapse-button="true" aria-expanded="true"></button></div>
      <div id="r2" class="ReviewThread-module__thread--x1y2"><div class="ReviewThread-module__header--a1"></div>
        <button data-is-first-collapse-button="true" aria-label="Expand thread"></button></div>`);
    const items = collectCommentToggles(document, 'conversation');
    expect(items.map((i) => [i.el.id, i.expanded])).toEqual([
      ['r1', true],
      ['r2', false],
    ]);
  });

  test('empty page → info toast', () => {
    const ctx = makeCtx();
    runAction('toggleComments', ctx);
    expect(ctx.show).toHaveBeenCalledWith('No review threads on this page', expect.objectContaining({ variant: 'info' }));
  });
});

describe('toggleComments — classic files tab', () => {
  test('flips "Show comments" only on commented files that differ', () => {
    fixture(`
      <div id="n1" class="js-file show-inline-notes"><input type="checkbox" class="js-toggle-file-notes" checked><div class="js-inline-comments-container"></div></div>
      <div id="n2" class="js-file"><input type="checkbox" class="js-toggle-file-notes"><div class="js-inline-comments-container"></div></div>
      <div id="n3" class="js-file show-inline-notes"><input type="checkbox" class="js-toggle-file-notes" checked></div>`);
    const changed: string[] = [];
    document.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.closest('.js-file') as HTMLElement;
      changed.push(file.id);
      file.classList.toggle('show-inline-notes', input.checked);
    });
    const ctx = makeCtx(`${PR}/files`);
    runAction('toggleComments', ctx);
    expect(changed).toEqual(['n1']);
    expect(document.getElementById('n2')?.classList.contains('show-inline-notes')).toBe(false);
    expect(document.getElementById('n3')?.classList.contains('show-inline-notes')).toBe(true); // no comments → untouched
    expect(ctx.show).toHaveBeenLastCalledWith('Inline comments hidden (1)', expect.anything());
  });
});

describe('toggleFiles', () => {
  const file = (id: string, open: boolean): string =>
    `<div id="${id}" class="file js-file js-details-container Details${open ? ' Details--on open' : ''}">
      <div class="file-header"><button class="btn-octicon js-details-target" aria-label="Toggle diff contents" aria-expanded="${open}"></button></div>
    </div>`;

  test('classic: clicks only the file toggles that differ', () => {
    fixture(file('f1', true) + file('f2', false) + file('f3', true));
    const clicked = wireToggleButtons('.js-file', 'button.js-details-target', ['open', 'Details--on']);
    const ctx = makeCtx(`${PR}/files`);
    runAction('toggleFiles', ctx);
    expect(clicked).toEqual(['f1', 'f3']);
    expect(ctx.show).toHaveBeenLastCalledWith('Files collapsed (2)', expect.anything());
    runAction('toggleFiles', ctx);
    expect(clicked).toEqual(['f1', 'f3', 'f1', 'f2', 'f3']);
  });

  test('React: header icon button labelled through a tooltip', () => {
    fixture(`
      <div id="diff-a"><div class="DiffFileHeader-module__diff-file-header--q1w2">
        <button aria-haspopup="true" aria-expanded="false">More</button>
        <button aria-labelledby="tip-a"></button><span id="tip-a" role="tooltip">Collapse file</span>
      </div></div>
      <div id="diff-b"><div class="DiffFileHeader-module__diff-file-header--q1w2">
        <button aria-label="Expand file"></button>
      </div></div>`);
    const items = collectFileToggles(document);
    expect(items.map((i) => [i.el.id, i.expanded])).toEqual([
      ['diff-a', true],
      ['diff-b', false],
    ]);
  });

  test('outside the Files tab → explains where it works, with a way to get there', () => {
    const ctx = makeCtx();
    runAction('toggleFiles', ctx);
    const [message, opts] = ctx.show.mock.calls[0];
    expect(message).toContain('works on the Files changed tab');
    expect(opts).toEqual(expect.objectContaining({ variant: 'warning', action: expect.objectContaining({ label: 'Go to Files changed' }) }));
  });
});

describe('unresolved threads', () => {
  test('pickThreadIndex by position, with wrap-around', () => {
    const tops = [-500, -100, 50, 300, 900];
    expect(pickThreadIndex(tops, 1, 120, null)).toBe(3);
    expect(pickThreadIndex(tops, -1, 120, null)).toBe(2);
    expect(pickThreadIndex([-300, -10], 1, 120, null)).toBe(0); // nothing below → wrap to first
    expect(pickThreadIndex([400, 800], -1, 120, null)).toBe(1); // nothing above → wrap to last
    expect(pickThreadIndex([], 1, 120, null)).toBe(-1);
  });

  test('pickThreadIndex steps from the current thread and wraps', () => {
    const tops = [0, 0, 0];
    expect(pickThreadIndex(tops, 1, 120, 0)).toBe(1);
    expect(pickThreadIndex(tops, 1, 120, 2)).toBe(0);
    expect(pickThreadIndex(tops, -1, 120, 0)).toBe(2);
  });

  test('isResolved markers', () => {
    fixture(`
      <div id="a" data-resolved="true"></div>
      <div id="b" class="js-resolvable-thread-container"><div data-resolved="false"></div></div>
      <div id="c"><span class="Label">Resolved</span></div>
      <div id="d"><button> Unresolve   conversation </button></div>
      <div id="e"><div class="markdown-body"><span class="Label">Resolved</span></div></div>`);
    const r = (id: string): boolean => isResolved(document.getElementById(id) as Element);
    expect([r('a'), r('b'), r('c'), r('d'), r('e')]).toEqual([true, false, true, true, false]);
  });

  test('collects unresolved threads in document order across markup generations', () => {
    fixture(`
      <review-thread-collapsible id="c1" class="review-thread-component" data-resolved="false"></review-thread-collapsible>
      <review-thread-collapsible id="c2" class="review-thread-component" data-resolved="true"></review-thread-collapsible>
      <details id="l1" class="js-resolvable-timeline-thread-container" data-resolved="false"></details>
      <div class="markdown-body"><div id="md" class="review-thread-component" data-resolved="false"></div></div>
      <table><tbody><tr id="i1" class="js-inline-comments-container"><td><button>Resolve conversation</button></td></tr>
      <tr id="i2" class="js-inline-comments-container"><td><button>Unresolve conversation</button></td></tr></tbody></table>
      <div id="x1" data-testid="review-thread"><div class="ReviewThread-module__body--z"></div></div>`);
    expect(collectUnresolvedThreads(document).map((e) => e.id)).toEqual(['c1', 'l1', 'i1', 'x1']);
  });

  test('navigator steps forward/back with wrap, reveals and highlights the target', async () => {
    fixture(`
      <review-thread-collapsible id="u1" class="review-thread-component open" data-resolved="false">
        <button data-target="review-thread-collapsible.button" aria-expanded="true"></button></review-thread-collapsible>
      <review-thread-collapsible id="u2" class="review-thread-component" data-resolved="false">
        <button data-target="review-thread-collapsible.button" aria-expanded="false"></button></review-thread-collapsible>
      <review-thread-collapsible id="u3" class="review-thread-component open" data-resolved="false">
        <button data-target="review-thread-collapsible.button" aria-expanded="true"></button></review-thread-collapsible>`);
    wireToggleButtons('review-thread-collapsible', 'button');
    const controller = new AbortController();
    const nav = createThreadNavigator(controller.signal);
    const ctx = makeCtx();
    const visited: string[] = [];
    const step = (dir: 1 | -1): void => {
      nav.step(dir, ctx);
      const [message] = ctx.show.mock.calls[ctx.show.mock.calls.length - 1];
      visited.push(message);
    };
    step(1);
    step(1);
    expect(document.getElementById('u2')?.classList.contains('open')).toBe(true); // collapsed target got expanded
    step(1);
    step(1);
    step(-1);
    expect(visited).toEqual([
      'Unresolved thread 1 of 3',
      'Unresolved thread 2 of 3',
      'Unresolved thread 3 of 3',
      'Unresolved thread 1 of 3',
      'Unresolved thread 3 of 3',
    ]);
    await nextFrame();
    const u3 = document.getElementById('u3') as HTMLElement;
    expect(u3.classList.contains('bghub-thread-focus')).toBe(true);
    expect(document.activeElement).toBe(u3);
    expect(window.scrollTo).toHaveBeenCalled();
    controller.abort();
    expect(u3.classList.contains('bghub-thread-focus')).toBe(false);
  });

  test('navigator with nothing unresolved', () => {
    fixture('<review-thread-collapsible data-resolved="true"></review-thread-collapsible>');
    const ctx = makeCtx();
    createThreadNavigator(new AbortController().signal).step(1, ctx);
    expect(ctx.show).toHaveBeenCalledWith('No unresolved threads. Nice work!', expect.anything());
  });
});

describe('PR info extraction', () => {
  test('parseHeadRef: same repo vs fork', () => {
    expect(parseHeadRef('o/r:feature/x', 'o')).toEqual({ branch: 'feature/x', display: 'feature/x' });
    expect(parseHeadRef('octocat:patch-1', 'o')).toEqual({ branch: 'patch-1', display: 'octocat:patch-1' });
    expect(parseHeadRef(' main ', 'o')).toEqual({ branch: 'main', display: 'main' });
    expect(parseHeadRef('', 'o')).toBeNull();
  });

  test('findHeadRef from the classic header (title attribute wins)', () => {
    fixture(`<div class="gh-header-meta">
      <span class="commit-ref base-ref" title="o/r:main"><a><span class="css-truncate-target">main</span></a></span>
      <span class="commit-ref head-ref" title="fork-owner/r:fix/thing"><a><span>fork-owner</span>:<span>fix/thing</span></a></span>
    </div>`);
    expect(findHeadRef(document, 'o')).toEqual({ branch: 'fix/thing', display: 'fork-owner:fix/thing' });
  });

  test('findHeadRef from React markup and the API fallback', () => {
    fixture('<span data-testid="head-ref-name">feat/new-ui</span>');
    expect(findHeadRef(document, 'o')).toEqual({ branch: 'feat/new-ui', display: 'feat/new-ui' });
    fixture('<div></div>');
    expect(findHeadRef(document, 'o')).toBeNull();
    expect(headRefFromApi({ head: { ref: 'dev', label: 'someone:dev' } }, 'o')).toEqual({ branch: 'dev', display: 'someone:dev' });
    expect(headRefFromApi({ head: {} }, 'o')).toBeNull();
    expect(headRefFromApi(null, 'o')).toBeNull();
  });

  test('title sources and cleanup', () => {
    expect(cleanTitle('  Fix   the bug #12 ', 12)).toBe('Fix the bug');
    expect(cleanTitle('Fix the bug - #12', 12)).toBe('Fix the bug');
    expect(cleanTitle('Bump to #3 #12', 12)).toBe('Bump to #3');
    expect(titleFromDocumentTitle('Add [beta] by mona · Pull Request #12 · o/r · GitHub')).toBe('Add [beta]');
    expect(titleFromDocumentTitle('Written by hand by mona · Pull Request #12 · o/r')).toBe('Written by hand');
    expect(titleFromDocumentTitle('o/r: something else')).toBeNull();

    fixture('<h1 class="gh-header-title"><bdi class="js-issue-title markdown-title">Speed up CI</bdi> <span>#12</span></h1>');
    expect(findTitle(document, 12)).toBe('Speed up CI');
    fixture('<main><h1>Refactor parser #12</h1></main>');
    expect(findTitle(document, 12)).toBe('Refactor parser');
    fixture('<div></div>');
    expect(findTitle(document, 12, 'From the tab by mona · Pull Request #12 · o/r · GitHub')).toBe('From the tab');
  });

  test('markdownLink escapes brackets', () => {
    expect(markdownLink('Add [beta] flag', 12, 'https://github.com/o/r/pull/12')).toBe('[Add \\[beta\\] flag (#12)](https://github.com/o/r/pull/12)');
  });
});

describe('PR tab navigation', () => {
  const page = parsePage(PR);

  test('paths and exact tab detection', () => {
    expect(tabPaths(page, 'files')).toEqual(['/o/r/pull/1/files', '/o/r/pull/1/changes']);
    expect(isOnTab('/o/r/pull/1/', page, 'conversation')).toBe(true);
    expect(isOnTab('/o/r/pull/1/commits/abc', page, 'commits')).toBe(false);
    expect(isOnTab('/o/r/pull/1/changes', page, 'files')).toBe(true);
  });

  test('prefers the tab nav link over other links to the same path', () => {
    fixture(`<div class="markdown-body"><a id="md" href="/o/r/pull/1/commits">commits</a></div>
      <a id="other" href="/o/r/pull/1/commits">timeline link</a>
      <nav aria-label="Pull request tabs"><a id="tab" class="tabnav-tab" href="/o/r/pull/1/commits">Commits</a></nav>`);
    expect(findTabLink(document, tabPaths(page, 'commits'))?.id).toBe('tab');
    document.querySelector('nav')?.remove();
    expect(findTabLink(document, tabPaths(page, 'commits'))?.id).toBe('other');
  });

  test('goto clicks the tab link', () => {
    fixture('<nav aria-label="Pull request tabs"><a id="tab" href="/o/r/pull/1/checks">Checks</a></nav>');
    const onClick = jest.fn((e: Event) => e.preventDefault());
    document.getElementById('tab')?.addEventListener('click', onClick);
    runAction('gotoChecks', makeCtx());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('keyboard', () => {
  const altC: KeyboardEventInit = { code: 'KeyC', key: 'ç', altKey: true, bubbles: true, cancelable: true };

  function setup(settings = { shortcutsEnabled: true, shortcutBindings: undefined as unknown }, sheetOpen = false) {
    const controller = new AbortController();
    const run = jest.fn<void, [ShortcutAction, ShortcutBinding | null]>();
    const sheet = { isOpen: () => sheetOpen, close: jest.fn() };
    installKeyboard({ signal: controller.signal, run, sheet, getSettings: () => settings });
    return { run, sheet, abort: () => controller.abort() };
  }

  test('runs the bound action on the physical key and consumes the event', () => {
    const { run, abort } = setup();
    const ev = new KeyboardEvent('keydown', altC);
    document.body.dispatchEvent(ev);
    expect(run).toHaveBeenCalledWith('toggleComments', expect.objectContaining({ code: 'KeyC', alt: true }));
    expect(ev.defaultPrevented).toBe(true);
    abort();
    document.body.dispatchEvent(new KeyboardEvent('keydown', altC));
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('ignores editable targets and GitHub overlays', () => {
    fixture(`<input id="i" type="text"><textarea id="t"></textarea><div id="ce" contenteditable="true"><span id="ces">x</span></div>
      <div role="dialog"><button id="dlg">ok</button></div><input id="cb" type="checkbox">`);
    const { run, abort } = setup();
    for (const id of ['i', 't', 'ces', 'dlg']) document.getElementById(id)?.dispatchEvent(new KeyboardEvent('keydown', altC));
    expect(run).not.toHaveBeenCalled();
    document.getElementById('cb')?.dispatchEvent(new KeyboardEvent('keydown', altC));
    expect(run).toHaveBeenCalledTimes(1);
    abort();
  });

  test('does nothing when shortcuts are disabled, or for unbound actions', () => {
    const disabled = setup({ shortcutsEnabled: false, shortcutBindings: undefined });
    document.body.dispatchEvent(new KeyboardEvent('keydown', altC));
    expect(disabled.run).not.toHaveBeenCalled();
    disabled.abort();

    const bindings = { ...defaultBindings(), toggleComments: null };
    const unbound = setup({ shortcutsEnabled: true, shortcutBindings: bindings });
    document.body.dispatchEvent(new KeyboardEvent('keydown', altC));
    expect(unbound.run).not.toHaveBeenCalled();
    unbound.abort();
  });

  test('while the cheat sheet is open only its own key is handled', () => {
    const { run, sheet, abort } = setup(undefined, true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', altC));
    expect(run).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Slash', key: '/', altKey: true, bubbles: true }));
    expect(sheet.close).toHaveBeenCalledTimes(1);
    abort();
  });
});

describe('toasts', () => {
  test('popover-less fallback, update-in-place by id, max three, cleanup on abort', async () => {
    const controller = new AbortController();
    const toasts = attachToaster(controller.signal);
    toasts.show('Thread 1 of 3', { id: 'nav' });
    toasts.show('Thread 2 of 3', { id: 'nav', variant: 'info' });
    expect(_toastElements()).toHaveLength(1);
    expect(_toastElements()[0].textContent).toContain('Thread 2 of 3');
    expect(_toastElements()[0].classList.contains('bghub-toast--info')).toBe(true);

    for (const m of ['a', 'b', 'c', 'd']) toasts.show(m);
    expect(_toastElements()).toHaveLength(3);
    const host = document.querySelector('.bghub-toast-host');
    expect(host?.classList.contains('bghub-toast-host--fallback')).toBe(true);
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();

    controller.abort();
    await flushMicrotasks();
    expect(document.querySelector('.bghub-toast-host')).toBeNull();
  });

  test('survives a synchronous remount (settings change)', async () => {
    const first = new AbortController();
    attachToaster(first.signal).show('Floating button hidden');
    first.abort();
    const second = new AbortController();
    attachToaster(second.signal);
    await flushMicrotasks();
    expect(_toastElements()).toHaveLength(1);
    second.abort();
    await flushMicrotasks();
  });

  test('action button runs and dismisses', () => {
    const controller = new AbortController();
    const run = jest.fn();
    attachToaster(controller.signal).show('Wrong tab', { variant: 'warning', action: { label: 'Go', run } });
    (document.querySelector('.bghub-toast-action') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(_toastElements()).toHaveLength(0);
    controller.abort();
  });
});

describe('cheat sheet', () => {
  test('groups, key caps, "Not set" and tab dimming', () => {
    const bindings = { ...defaultBindings(), copyBranch: null };
    const el = renderGroups(bindings, 'conversation', 'cs');
    expect(Array.from(el.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['View', 'Navigate', 'Copy', 'Write', 'Help']);
    expect(el.querySelectorAll('.bghub-cs-row')).toHaveLength(SHORTCUT_DEFINITIONS.length);
    const row = (a: string): Element => el.querySelector(`[data-action="${a}"]`) as Element;
    expect(row('copyBranch').textContent).toContain('Not set');
    expect(row('toggleFiles').classList.contains('bghub-cs-row--inactive')).toBe(true);
    expect(row('toggleFiles').textContent).toContain('Files changed tab');
    expect(row('toggleComments').classList.contains('bghub-cs-row--inactive')).toBe(false);
    expect(row('toggleComments').querySelectorAll('kbd').length).toBeGreaterThanOrEqual(2);
    expect(renderGroups(bindings, 'commits', 'cs').querySelector('[data-action="toggleComments"]')?.textContent).toContain(
      'Conversation & Files changed'
    );
  });

  test('opens as a labelled dialog and toggles closed', () => {
    const controller = new AbortController();
    const onOpenChange = jest.fn();
    const sheet = createCheatsheet({ signal: controller.signal, toasts: { show: jest.fn() }, onOpenChange });
    sheet.toggle();
    const dialog = document.querySelector('dialog.bghub-cheatsheet') as HTMLDialogElement;
    expect(sheet.isOpen()).toBe(true);
    expect(document.activeElement).toBe(dialog); // panel focused, not the close button
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe('Keyboard shortcuts');
    expect(dialog.querySelector('.bghub-cs-btn--invisible')?.textContent).toBe('Hide floating button');
    sheet.toggle();
    expect(sheet.isOpen()).toBe(false);
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    controller.abort();
  });
});

describe('feature lifecycle', () => {
  test('same PR on another tab keeps the mount; another PR remounts', () => {
    const remount = prPageFeature.shouldRemount as NonNullable<typeof prPageFeature.shouldRemount>;
    expect(remount(parsePage(PR), parsePage(`${PR}/files`))).toBe(false);
    expect(remount(parsePage(PR), parsePage('https://github.com/o/r/pull/2'))).toBe(true);
  });

  test('a remount in the same task is not a new visit', async () => {
    const a = new AbortController();
    expect(beginVisit('pr-x', a.signal)).toBe(true);
    a.abort();
    const b = new AbortController();
    expect(beginVisit('pr-x', b.signal)).toBe(false);
    b.abort();
    await flushMicrotasks();
    const c = new AbortController();
    expect(beginVisit('pr-x', c.signal)).toBe(true);
    c.abort();
    await flushMicrotasks();
  });

  test('marks the PR as seen once per visit', async () => {
    const runtime = chrome.runtime as unknown as { id?: string; sendMessage: unknown };
    const original = runtime.sendMessage;
    const send = jest.fn(() => Promise.resolve({ ok: true, unseenCount: 0 }));
    runtime.id = 'test-extension';
    runtime.sendMessage = send;
    try {
      const page = parsePage('https://github.com/o/r/pull/7');
      const first = new AbortController();
      void prPageFeature.mount({ page, signal: first.signal });
      first.abort();
      const second = new AbortController();
      void prPageFeature.mount({ page, signal: second.signal }); // settings remount
      // Visit tracking and the pending-review check also talk to the background.
      const marks = (send.mock.calls as unknown as { type: string }[][]).filter(([m]) => m.type === 'inbox:markSeen');
      expect(marks).toHaveLength(1);
      expect(send).toHaveBeenCalledWith({ type: 'inbox:markSeen', urls: ['https://github.com/o/r/pull/7'] });
      second.abort();
      await flushMicrotasks();
    } finally {
      runtime.sendMessage = original;
      delete runtime.id;
    }
  });
});

describe('React PR header (live DOM, Nov 2026)', () => {
  test('title comes from the markdownTitle span, not the whole sticky PH_Title', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <h2 data-component="PH_Title"><span class="markdownTitle__x">Fix it</span>#12 Ada wants to merge</h2>
      <h1 data-component="Heading"><span class="markdownTitle__jQX53G">Fix it</span><span class="sr-only"> - #12</span></h1>`;
    expect(findTitle(root, 12, '')).toBe('Fix it');
  });

  test('head branch is deduped across the duplicated (sticky) header', () => {
    const root = document.createElement('div');
    root.innerHTML = ['main', 'feat/x', 'main', 'feat/x'].map((b) => `<a data-component="BranchName">${b}</a>`).join('');
    expect(findHeadRef(root, 'o')).toEqual({ branch: 'feat/x', display: 'feat/x' });
  });
});
