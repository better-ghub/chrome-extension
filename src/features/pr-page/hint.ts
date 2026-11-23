// Better GHub - PR page: floating "keyboard shortcuts" button (bottom-right).

import { h, prefersReducedMotion, removeAnimated } from '../../core/dom';
import { icon } from '../../core/icons';
import { t } from '../../i18n';
import { formatBinding, type ShortcutBinding } from '../../shortcuts';

export interface Hint {
  setExpanded(open: boolean): void;
}

interface HintOptions {
  signal: AbortSignal;
  /** Current showHelp binding (shown in the tooltip / accessible name). */
  binding: ShortcutBinding | null;
  /** Pop in after a short delay (first visit to this PR) instead of appearing instantly. */
  animate: boolean;
  onClick(): void;
}

const ENTER_DELAY_MS = 600;
let current: HTMLButtonElement | null = null;

export function hintLabel(binding: ShortcutBinding | null): string {
  return binding ? t('prPageHintLabel', 'Keyboard shortcuts ($1)', formatBinding(binding)) : t('prPageCheatsheetTitle', 'Keyboard shortcuts');
}

export function mountHint({ signal, binding, animate, onClick }: HintOptions): Hint {
  const label = hintLabel(binding);
  const btn = h(
    'button',
    {
      class: 'bghub-hint',
      attrs: { type: 'button', 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-tooltip': label, 'data-bghub': '' },
      on: { click: onClick },
    },
    icon('command-palette', 16)
  );
  current = btn;

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Children of <html> survive Turbo's <body> swaps between PR tabs.
  if (animate && !prefersReducedMotion()) {
    btn.classList.add('bghub-hint--enter');
    timer = setTimeout(() => {
      if (!signal.aborted) document.documentElement.append(btn);
    }, ENTER_DELAY_MS);
  } else {
    document.documentElement.append(btn);
  }

  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      // A remount (settings change) creates its replacement synchronously:
      // swap instantly then; animate out only when the button really goes away.
      queueMicrotask(() => {
        if (current && current !== btn) btn.remove();
        else {
          current = null;
          removeAnimated(btn);
        }
      });
    },
    { once: true }
  );

  return { setExpanded: (open) => btn.setAttribute('aria-expanded', String(open)) };
}
