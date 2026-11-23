// Better GHub - PR page: collapse generated files automatically on the Files tab.
//
// Each matching file is collapsed ONCE: its path goes into a "handled" set
// before we touch it, so re-scans (GitHub lazy-loads the diff in batches and
// the React view virtualizes file rows) never fight a user who re-expanded it.
// The set survives a synchronous remount (settings change) of the same page
// and is dropped when the reader leaves it, so coming back starts fresh.

import { h, observe } from '../../core/dom';
import { t } from '../../i18n';
import type { ShortcutBinding } from '../../shortcuts';
import { attachTooltip } from '../../ui/tooltip';
import { withScrollAnchor } from './actions/scroll';
import { collectDiffFiles, type DiffFile } from './files-model';
import { matchesGenerated } from '../../core/generated-patterns';
import type { Toaster } from './toast';

const CHIP_CLASS = 'bghub-gen-chip';
/** Let the first lazy-loaded batches land so the toast counts them too. */
const TOAST_DELAY_MS = 700;

interface Memo {
  key: string;
  handled: Set<string>;
  collapsed: number;
  toasted: boolean;
  users: number;
}

let memo: Memo | null = null;

function claimMemo(key: string, signal: AbortSignal): Memo {
  if (!memo || memo.key !== key) memo = { key, handled: new Set(), collapsed: 0, toasted: false, users: 0 };
  const m = memo;
  m.users++;
  signal.addEventListener(
    'abort',
    () => {
      m.users--;
      queueMicrotask(() => {
        if (m.users === 0 && memo === m) memo = null;
      });
    },
    { once: true }
  );
  return m;
}

export interface AutoCollapseOptions {
  signal: AbortSignal;
  toasts: Toaster;
  patterns: readonly string[];
  /** Identity of the diff being shown (pathname + search). */
  pageKey: string;
  /** Current toggleGenerated binding, shown as key caps in the toast. */
  binding(): ShortcutBinding | null;
  /** Toast action: expand every generated file again. */
  expandAll(): void;
  root?: ParentNode;
}

/** Where the chip goes: classic `.file-info` (after the path), else next to the React file name. */
function chipHost(header: HTMLElement): HTMLElement {
  return header.querySelector<HTMLElement>('.file-info') ?? header.querySelector('h3')?.parentElement ?? header;
}

export function startAutoCollapse(o: AutoCollapseOptions): { scan(): void } {
  const { signal } = o;
  const root = o.root ?? document;
  const state = claimMemo(o.pageKey, signal);
  const notGenerated = new Set<string>();
  const chips = new Set<HTMLElement>();
  const tip = t('prPageGeneratedChipTip', 'Collapsed automatically by Better GHub');
  let timer: ReturnType<typeof setTimeout> | undefined;

  const ensureChip = (file: DiffFile): void => {
    if (!file.header || file.header.querySelector(`.${CHIP_CLASS}`)) return;
    const chip = h(
      'span',
      { class: `bghub-chip ${CHIP_CLASS}`, attrs: { 'data-bghub': '' } },
      t('prPageGeneratedChip', 'Generated'),
      h('span', { class: 'bghub-sr-only', text: ` (${tip})` })
    );
    attachTooltip(chip, () => tip, signal);
    chipHost(file.header).append(chip);
    chips.add(chip);
  };

  const showToast = (): void => {
    timer = undefined;
    if (signal.aborted || state.toasted || !state.collapsed) return;
    state.toasted = true;
    const n = state.collapsed;
    o.toasts.show(n === 1 ? t('prPageGeneratedAutoOne', 'Collapsed 1 generated file') : t('prPageGeneratedAuto', 'Collapsed $1 generated files', String(n)), {
      icon: 'fold',
      binding: o.binding(),
      id: 'generated',
      action: { label: t('prPageGeneratedExpandAction', 'Expand'), run: o.expandAll },
    });
  };

  const scan = (): void => {
    if (signal.aborted) return;
    const files = collectDiffFiles(root);
    const toCollapse: DiffFile[] = [];
    for (const file of files) {
      const { path } = file;
      if (!path || notGenerated.has(path)) continue;
      if (state.handled.has(path)) {
        ensureChip(file); // re-rendered header (React virtualization, remount)
        continue;
      }
      if (!matchesGenerated(path, o.patterns)) {
        notGenerated.add(path);
        continue;
      }
      if (!file.toggle) continue; // header not wired up yet: next scan
      state.handled.add(path);
      ensureChip(file);
      if (file.toggle.expanded) toCollapse.push(file);
    }
    if (toCollapse.length) {
      // Deep links (#diff-…) land mid-page: keep the reader's file in place.
      withScrollAnchor(
        files.map((f) => f.el),
        () => {
          for (const file of toCollapse) {
            try {
              file.toggle?.set(false);
              state.collapsed++;
            } catch {
              /* one broken header must not stop the rest */
            }
          }
        }
      );
    }
    if (state.collapsed && !state.toasted && (toCollapse.length || timer === undefined)) {
      clearTimeout(timer);
      timer = setTimeout(showToast, TOAST_DELAY_MS);
    }
  };

  observe(document.documentElement, scan, signal, { childList: true, subtree: true }, 150);
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      for (const chip of chips) chip.remove();
    },
    { once: true }
  );
  scan();
  return { scan };
}
