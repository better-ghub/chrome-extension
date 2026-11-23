import {
  formatChecklistText,
  parseChecklistText,
  parseTicks,
  pickTemplate,
  recordTicks,
  sanitizeTemplates,
  TICK_MAX_AGE_MS,
  MAX_TICK_PRS,
} from '../src/core/checklist-model';
import { loadedSoFar, remainingFrom } from '../src/features/pr-page/load-all-model';

describe('checklist templates', () => {
  const templates = sanitizeTemplates([
    { pattern: '*', items: ['a'] },
    { pattern: 'Acme/*', items: ['b'] },
    { pattern: 'acme/web', items: ['c'] },
  ]);

  it('picks the most specific match, case-insensitively', () => {
    expect(pickTemplate(templates, 'ACME', 'Web')?.items).toEqual(['c']);
    expect(pickTemplate(templates, 'acme', 'api')?.items).toEqual(['b']);
    expect(pickTemplate(templates, 'other', 'x')?.items).toEqual(['a']);
    expect(pickTemplate([], 'a', 'b')).toBeNull();
  });

  it('drops invalid patterns, empty and duplicate templates and clamps items', () => {
    const out = sanitizeTemplates([
      { pattern: 'bad pattern', items: ['x'] },
      { pattern: '*', items: [] },
      { pattern: '*', items: ['  ok  ', 5, 'y'.repeat(300)] },
      { pattern: '*', items: ['dup'] },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].items[0]).toBe('ok');
    expect(out[0].items[1]).toHaveLength(200);
    expect(sanitizeTemplates(Array.from({ length: 40 }, (_, i) => ({ pattern: 'o/r', items: [String(i)] })))).toHaveLength(1);
    expect(sanitizeTemplates([{ pattern: '*', items: Array.from({ length: 50 }, (_, i) => `i${i}`) }])[0].items).toHaveLength(30);
    expect(sanitizeTemplates('nope')).toEqual([]);
  });

  it('round-trips through the editor text', () => {
    const text = '[acme/web]\n- Tests\n* Docs\n\n[*]\nSelf-reviewed\n[bad]\n- ignored';
    const parsed = parseChecklistText(text);
    expect(parsed).toEqual([
      { pattern: 'acme/web', items: ['Tests', 'Docs'] },
      { pattern: '*', items: ['Self-reviewed'] },
    ]);
    expect(parseChecklistText(formatChecklistText(parsed))).toEqual(parsed);
  });
});

describe('checklist ticks', () => {
  it('prunes by age and cap, and removes empty records', () => {
    const now = 1e12;
    let ticks = parseTicks({ old: { done: ['a'], at: now - TICK_MAX_AGE_MS - 1 }, bad: { done: 'x', at: 1 } });
    ticks = recordTicks(ticks, 'k', ['a'], now);
    expect(Object.keys(ticks)).toEqual(['k']);
    expect(recordTicks(ticks, 'k', [], now)).toEqual({});
    const many = Object.fromEntries(Array.from({ length: MAX_TICK_PRS + 20 }, (_, i) => [`p${i}`, { done: ['a'], at: now - i }]));
    expect(Object.keys(recordTicks(many, 'k', ['a'], now))).toHaveLength(MAX_TICK_PRS);
  });
});

describe('load-all model', () => {
  it('reads the remaining count', () => {
    expect(remainingFrom('229 remaining items\nLoad more')).toBe(229);
    expect(remainingFrom('1,204 hidden items')).toBe(1204);
    expect(remainingFrom('229')).toBe(229);
    expect(remainingFrom('Load more')).toBeNull();
    expect(loadedSoFar(229, 79)).toBe(150);
    expect(loadedSoFar(null, 5)).toBeNull();
  });
});
