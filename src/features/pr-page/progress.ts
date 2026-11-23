// Better GHub - PR page: review progress pill ("12 / 30 files viewed" + Next unviewed).
//
// Floats bottom-left (fixed, just below GitHub's sticky layer, like the hint
// button): the top of the viewport belongs to GitHub's sticky diff toolbar and
// sticky file headers. Shown only while GitHub renders "Viewed" controls
// (logged-in users). Live: re-counts on checkbox changes and DOM updates
// (lazy-loaded batches, GitHub re-rendering a header after saving).

import { h, observe, removeAnimated } from '../../core/dom';
import { icon } from '../../core/icons';
import { t } from '../../i18n';
import { formatBinding, type ShortcutBinding } from '../../shortcuts';
import { attachTooltip } from '../../ui/tooltip';
import { allViewedText } from './actions/review';
import { collectDiffFiles } from './files-model';
import { progressCounts } from './progress-model';

interface ProgressOptions {
  signal: AbortSignal;
  onNext(): void;
  /** The last file was just ticked (not called for a page that loads fully viewed). */
  onComplete(total: number): void;
  /** Current nextUnviewed binding, for the button's tooltip. */
  binding(): ShortcutBinding | null;
}

type Counts = { viewed: number; total: number };

let current: HTMLElement | null = null;

export function countViewed(root: ParentNode = document): Counts {
  return progressCounts(collectDiffFiles(root).map((f) => ({ viewed: f.viewed ? f.viewed.checked : null })));
}

export function mountProgress({ signal, onNext, onComplete, binding }: ProgressOptions): { update(): void } {
  const nextLabel = t('prPageProgressNext', 'Next unviewed');
  const text = h('span', { class: 'bghub-progress-text' });
  const fill = h('span', { class: 'bghub-progress-fill' });
  const meter = h('span', { class: 'bghub-progress-meter', attrs: { role: 'progressbar', 'aria-valuemin': 0, 'aria-label': t('prPageProgressMeter', 'Files viewed') } }, fill);
  const glyph = h('span', { class: 'bghub-progress-icon' });
  const next = h('button', { class: 'bghub-progress-next', attrs: { type: 'button' }, on: { click: () => onNext() } }, h('span', { text: nextLabel }), icon('arrow-down', 16));
  attachTooltip(next, () => {
    const b = binding();
    return b ? `${nextLabel} (${formatBinding(b)})` : nextLabel;
  }, signal);
  const pill = h(
    'div',
    { class: 'bghub-progress', attrs: { role: 'group', 'aria-label': t('prPageProgressLabel', 'Review progress'), 'data-bghub': '' } },
    glyph,
    text,
    meter,
    next
  );

  let shown: Counts | null = null;
  let frame = 0;

  const render = ({ viewed, total }: Counts): void => {
    const done = viewed === total;
    const label = done ? allViewedText(total) : t('prPageProgressText', '$1 / $2 files viewed', [String(viewed), String(total)]);
    text.textContent = label;
    fill.style.transform = `scaleX(${total ? viewed / total : 0})`;
    meter.setAttribute('aria-valuemax', String(total));
    meter.setAttribute('aria-valuenow', String(viewed));
    meter.setAttribute('aria-valuetext', label);
    glyph.replaceChildren(icon(done ? 'check-circle-fill' : 'eye', 16));
    next.hidden = done;
    pill.classList.toggle('bghub-progress--done', done);
  };

  const update = (): void => {
    frame = 0;
    if (signal.aborted) return;
    const counts = countViewed();
    if (!counts.total) {
      pill.remove();
      shown = null;
      return;
    }
    if (shown && shown.viewed === counts.viewed && shown.total === counts.total) return;
    const completed = !!shown && shown.viewed < shown.total && counts.viewed === counts.total;
    render(counts);
    if (!pill.isConnected) {
      // Replacing a pill from a synchronous remount: no entrance animation.
      if (current && current !== pill && current.isConnected) pill.classList.add('bghub-progress--instant');
      current = pill;
      document.documentElement.append(pill); // children of <html> survive Turbo body swaps
    }
    if (completed) {
      pill.classList.remove('bghub-progress--celebrate');
      void pill.offsetWidth;
      pill.classList.add('bghub-progress--celebrate');
      onComplete(counts.total);
    }
    shown = counts;
  };

  const schedule = (): void => {
    if (!frame && !signal.aborted) frame = requestAnimationFrame(update);
  };

  document.addEventListener('change', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') schedule();
  }, { capture: true, signal });
  observe(document.documentElement, schedule, signal, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked'] }, 150);

  signal.addEventListener(
    'abort',
    () => {
      cancelAnimationFrame(frame);
      queueMicrotask(() => {
        if (current && current !== pill) pill.remove();
        else {
          current = null;
          removeAnimated(pill);
        }
      });
    },
    { once: true }
  );
  update();
  return { update };
}
