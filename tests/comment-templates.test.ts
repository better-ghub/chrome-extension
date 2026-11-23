import { coerce, MAX_SNIPPET_BODY, MAX_SNIPPETS, sanitizeSnippets } from '../src/core/settings';
import { insertText } from '../src/features/comment-templates/insert';
import { buildEntries, isCommentTextarea, labelText, placePopover, rankEntries } from '../src/features/comment-templates/model';
import { createTemplatePicker } from '../src/features/comment-templates/picker';
import { commentTemplatesFeature } from '../src/features/comment-templates';
import { parsePage } from '../src/core/page';
import { sameSnippets } from '../options/templates-view';
import { parseRoute } from '../src/pages/route';
import { SHORTCUT_DEFINITIONS, normalizeBindings } from '../src/shortcuts';
import { resolveShortcut } from '../src/features/pr-page/keyboard';

describe('snippet settings', () => {
  test('sanitizeSnippets drops junk, trims titles and caps lengths', () => {
    const out = sanitizeSnippets([
      { title: '  LGTM ', body: 'ok' },
      { title: '', body: 'x' },
      { title: 'no body', body: '  ' },
      { title: 5, body: 'x' },
      null,
      { title: 'long', body: 'a'.repeat(MAX_SNIPPET_BODY + 50) },
    ]);
    expect(out.map((s) => s.title)).toEqual(['LGTM', 'long']);
    expect(out[1].body).toHaveLength(MAX_SNIPPET_BODY);
  });

  test('count is capped and non-arrays become empty', () => {
    const many = Array.from({ length: MAX_SNIPPETS + 10 }, (_, i) => ({ title: `t${i}`, body: 'b' }));
    expect(sanitizeSnippets(many)).toHaveLength(MAX_SNIPPETS);
    expect(coerce('commentSnippets', 'nope')).toEqual([]);
    expect(coerce('commentSnippets', undefined)).toEqual([]);
    expect(coerce('commentTemplatesEnabled', undefined)).toBe(true);
    expect(coerce('conventionalCommentsEnabled', 'x')).toBe(true);
  });

  test('sameSnippets compares by value', () => {
    expect(sameSnippets([{ title: 'a', body: 'b' }], [{ title: 'a', body: 'b' }])).toBe(true);
    expect(sameSnippets([{ title: 'a', body: 'b' }], [{ title: 'a', body: 'c' }])).toBe(false);
  });
});

describe('entries and ranking', () => {
  test('label text carries the decoration only where shown', () => {
    expect(labelText({ label: 'praise' })).toBe('**praise:** ');
    expect(labelText({ label: 'nitpick', decoration: 'non-blocking' })).toBe('**nitpick (non-blocking):** ');
  });

  test('snippets come first, labels can be switched off', () => {
    const all = buildEntries([{ title: 'LGTM', body: 'Looks good' }], true);
    expect(all[0]).toMatchObject({ kind: 'snippet', text: 'Looks good' });
    expect(all.filter((e) => e.kind === 'label').map((e) => e.title)).toEqual([
      'praise',
      'nitpick (non-blocking)',
      'suggestion',
      'issue (blocking)',
      'question',
      'thought',
      'chore',
      'todo',
    ]);
    expect(buildEntries([], false)).toEqual([]);
  });

  test('rankEntries filters and keeps order for an empty query', () => {
    const entries = buildEntries([{ title: 'Needs tests', body: 'Please add tests' }], true);
    expect(rankEntries('', entries)).toHaveLength(entries.length);
    expect(rankEntries('nit', entries)[0].entry.id).toBe('label-nitpick');
    expect(rankEntries('zzzz', entries)).toEqual([]);
  });

  test('placePopover stays inside the viewport and flips above', () => {
    const vp = { width: 1000, height: 700 };
    expect(placePopover({ left: 100, top: 100, width: 600, height: 200 }, { width: 400, height: 300 }, vp)).toEqual({ left: 108, top: 144 });
    expect(placePopover({ left: 900, top: 650, width: 600, height: 200 }, { width: 400, height: 300 }, vp)).toEqual({ left: 592, top: 346 });
  });
});

describe('isCommentTextarea', () => {
  const make = (html: string): HTMLTextAreaElement => {
    document.body.innerHTML = html;
    return document.querySelector('textarea') as HTMLTextAreaElement;
  };
  test.each([
    ['classic comment field', '<textarea class="js-comment-field"></textarea>'],
    ['review body', '<textarea name="pull_request_review[body]"></textarea>'],
    ['inline form', '<div class="js-inline-comment-form"><textarea name="x"></textarea></div>'],
    ['React editor', '<div data-testid="markdown-editor-comment"><textarea></textarea></div>'],
    ['markdown value', '<textarea aria-label="Markdown value"></textarea>'],
    ['toolbar', '<markdown-toolbar><textarea></textarea></markdown-toolbar>'],
  ])('matches %s', (_n, html) => expect(isCommentTextarea(make(html))).toBe(true));

  test('rejects plain, disabled and foreign fields', () => {
    expect(isCommentTextarea(make('<textarea></textarea>'))).toBe(false);
    expect(isCommentTextarea(make('<textarea class="js-comment-field" disabled></textarea>'))).toBe(false);
    expect(isCommentTextarea(make('<div data-bghub><textarea class="js-comment-field"></textarea></div>'))).toBe(false);
    expect(isCommentTextarea(document.body)).toBe(false);
    expect(isCommentTextarea(null)).toBe(false);
  });
});

describe('insertText', () => {
  test('falls back to setRangeText + input event when execCommand is unavailable', () => {
    document.body.innerHTML = '<textarea>hello world</textarea>';
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const onInput = jest.fn();
    ta.addEventListener('input', onInput);
    insertText(ta, '**todo:** ', { start: 6, end: 11 });
    expect(ta.value).toBe('hello **todo:** ');
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  test('uses execCommand when available', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const exec = jest.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    insertText(ta, 'x');
    expect(exec).toHaveBeenCalledWith('insertText', false, 'x');
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });
});

describe('picker and feature', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll('dialog').forEach((d) => d.remove());
  });

  test('Enter inserts the highlighted entry at the saved caret', () => {
    document.body.innerHTML = '<textarea class="js-comment-field">abc</textarea>';
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    ta.setSelectionRange(3, 3);
    const ctl = new AbortController();
    const picker = createTemplatePicker({ signal: ctl.signal });
    picker.open(ta, { snippets: [{ title: 'LGTM', body: ' Looks good' }], conventional: true });
    expect(picker.isOpen()).toBe(true);
    const input = document.querySelector('.bghub-ct input') as HTMLInputElement;
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ta.value).toBe('abc Looks good');
    expect(picker.isOpen()).toBe(false);
    ctl.abort();
  });

  test('typing filters; arrows move the selection', () => {
    document.body.innerHTML = '<textarea class="js-comment-field"></textarea>';
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    const ctl = new AbortController();
    const picker = createTemplatePicker({ signal: ctl.signal });
    picker.open(ta, { snippets: [], conventional: true });
    const input = document.querySelector('.bghub-ct input') as HTMLInputElement;
    input.value = 'quest';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.bghub-ct [role="option"]')).toHaveLength(1);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.querySelector('.bghub-ct [aria-selected="true"]')?.id).toBe(input.getAttribute('aria-activedescendant'));
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    expect((document.querySelector('.bghub-ct .bghub-ff-empty') as HTMLElement).hidden).toBe(false);
    ctl.abort();
  });

  test('registry entry has default Alt+; and the PR keyboard layer leaves it alone', () => {
    const def = SHORTCUT_DEFINITIONS.find((d) => d.action === 'commentTemplates');
    expect(def?.defaultBinding).toMatchObject({ code: 'Semicolon', alt: true });
    expect(normalizeBindings(undefined).commentTemplates?.code).toBe('Semicolon');
    const e = new KeyboardEvent('keydown', { code: 'Semicolon', key: '…', altKey: true, bubbles: true });
    expect(resolveShortcut(e, { shortcutsEnabled: true, shortcutBindings: undefined })).toBeNull();
  });

  test('feature: Alt+; in a comment textarea opens the picker and is consumed', async () => {
    const { initLiveSettings } = await import('../src/content/state');
    await initLiveSettings();
    document.body.innerHTML = '<textarea class="js-comment-field"></textarea><textarea id="other"></textarea>';
    const ctl = new AbortController();
    void commentTemplatesFeature.mount({ page: parsePage('https://github.com/o/r/issues/1'), signal: ctl.signal });
    const fire = (el: Element): KeyboardEvent => {
      const ev = new KeyboardEvent('keydown', { code: 'Semicolon', key: '…', altKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev;
    };
    expect(fire(document.getElementById('other') as Element).defaultPrevented).toBe(false);
    expect(document.querySelector('.bghub-ct[open]')).toBeNull();
    expect(fire(document.querySelector('.js-comment-field') as Element).defaultPrevented).toBe(true);
    expect(document.querySelector('.bghub-ct[open]')).not.toBeNull();
    ctl.abort();
  });

  test('routing: templates section and aliases', () => {
    expect(parseRoute('#templates').section).toBe('templates');
    expect(parseRoute('#snippets').section).toBe('templates');
  });
});
