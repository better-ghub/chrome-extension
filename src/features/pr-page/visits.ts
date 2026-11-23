// Better GHub - PR page: "changes since your last visit".
//
// On every PR visit the head SHA is fetched (via the background worker) and
// compared with the SHA stored on the previous visit. The previous record is
// kept in memory per PR for the page session so tab switches / remounts keep
// the information, while storage always holds the newest SHA.

import { h, observe } from '../../core/dom';
import { icon } from '../../core/icons';
import { sendToBackground } from '../../core/messages';
import type { PageContext } from '../../core/page';
import { debug } from '../../debug';
import { getLocale, t } from '../../i18n';
import type { ShortcutBinding } from '../../shortcuts';
import type { Toaster } from './toast';
import {
  changedSince,
  filesTabPath,
  interpretCompare,
  parseVisits,
  rangeFilesPath,
  recordVisit,
  relativeTime,
  visitKey,
  VISITS_STORAGE_KEY,
  type CompareOutcome,
  type VisitRecord,
} from './visits-model';

export interface VisitTracker {
  /** Navigate to the diff of the new commits (or explain why not). */
  showChanges(binding?: ShortcutBinding | null): void;
}

interface SessionInfo {
  prev: VisitRecord | null;
  head: string;
  outcome: CompareOutcome | null;
  dismissed: boolean;
}

/** Per-PR info for the lifetime of the page (survives remounts). */
const session = new Map<string, SessionInfo | Promise<SessionInfo | null>>();

const ANCHORS = ['#partial-discussion-header .gh-header-meta', '#partial-discussion-header', '.gh-header-show', '[data-testid="issue-header"]', '[data-component="PH_Title"]'];

async function readVisits(): Promise<ReturnType<typeof parseVisits>> {
  try {
    const stored = await chrome.storage.local.get([VISITS_STORAGE_KEY]);
    return parseVisits(stored[VISITS_STORAGE_KEY]);
  } catch {
    return {};
  }
}

async function fetchInfo(page: Required<Pick<PageContext, 'owner' | 'repo' | 'number'>>): Promise<SessionInfo | null> {
  const { owner, repo, number } = page;
  const pr = await sendToBackground('api:rest', { path: `/repos/${owner}/${repo}/pulls/${number}`, noCache: true }, { ok: false });
  const head = pr.ok ? (pr.data as { head?: { sha?: unknown } } | undefined)?.head?.sha : null;
  if (typeof head !== 'string' || !head) return null;

  const key = visitKey(owner, repo, number);
  const visits = await readVisits();
  const prev = changedSince(visits[key], head);
  const now = Date.now();
  try {
    await chrome.storage.local.set({ [VISITS_STORAGE_KEY]: recordVisit(visits, key, head, now) });
  } catch {
    /* storage unavailable: info for this session still works */
  }
  // Remember the unchanged record too, so a later change in this session is not lost.
  const info: SessionInfo = { prev, head, outcome: null, dismissed: false };
  if (prev) {
    const cmp = await sendToBackground('api:rest', { path: `/repos/${owner}/${repo}/compare/${prev.sha}...${head}?per_page=1` }, { ok: false });
    // 404/422: the old commit no longer exists (force-push). Other failures stay silent.
    if (cmp.ok) info.outcome = interpretCompare(cmp.data);
    else if (cmp.status === 404 || cmp.status === 422) info.outcome = { kind: 'rewritten' };
  }
  return info;
}

function describe(info: SessionInfo): string | null {
  const when = relativeTime(info.prev?.at ?? Date.now(), Date.now(), getLocale());
  const o = info.outcome;
  if (!o || o.kind === 'none') return null;
  return o.kind === 'commits'
    ? t('prPageNewCommits', 'New commits since your last visit: $1 ($2)', [String(o.count), when])
    : t('prPageRewritten', 'The branch was rewritten since your last visit ($1)', when);
}

export function startVisitTracking(page: PageContext, signal: AbortSignal, toasts: Toaster): VisitTracker {
  const { owner, repo, number } = page;
  let info: SessionInfo | null = null;
  let pill: HTMLElement | null = null;

  const go = (): void => {
    if (!info?.prev || !owner || !repo || !number) return;
    const rewritten = info.outcome?.kind !== 'commits';
    location.assign(rewritten ? filesTabPath(owner, repo, number) : rangeFilesPath(owner, repo, number, info.prev.sha, info.head));
  };

  const dismiss = (): void => {
    if (info) info.dismissed = true;
    pill?.remove();
    pill = null;
  };

  const buildPill = (text: string, rewritten: boolean): HTMLElement =>
    h(
      'div',
      { class: `bghub-since${rewritten ? ' bghub-since--rewritten' : ''}`, attrs: { role: 'status', 'data-bghub': '' } },
      h('span', { class: 'bghub-since-icon' }, icon(rewritten ? 'alert' : 'git-commit', 16)),
      h('span', { class: 'bghub-since-text', text }),
      h('button', {
        class: 'bghub-since-btn',
        attrs: { type: 'button' },
        text: rewritten ? t('prPageShowFiles', 'Show files') : t('prPageShowOnlyThese', 'Show only these changes'),
        on: { click: go },
      }),
      h('button', { class: 'bghub-since-close', attrs: { type: 'button', 'aria-label': t('prPageClose', 'Close') }, on: { click: dismiss } }, icon('x', 16))
    );

  const ensurePill = (): void => {
    if (!info || info.dismissed || signal.aborted) return;
    const text = describe(info);
    if (!text) return;
    if (pill?.isConnected) return;
    const anchor = ANCHORS.map((s) => document.querySelector(s)).find((el): el is Element => !!el);
    if (!anchor) return;
    pill = buildPill(text, info.outcome?.kind !== 'commits');
    anchor.after(pill);
  };

  const apply = (resolved: SessionInfo | null): void => {
    if (signal.aborted || !resolved) return;
    info = resolved;
    ensurePill();
    // Header may render late or be replaced by SPA navigation.
    observe(document.documentElement, ensurePill, signal);
    // No anchor at all → fall back to a toast (once).
    if (!pill && !info.dismissed) {
      const text = describe(info);
      if (text && !document.querySelector(ANCHORS.join(','))) {
        info.dismissed = true;
        toasts.show(text, { variant: 'info', icon: 'git-commit', action: { label: t('prPageShowOnlyThese', 'Show only these changes'), run: go }, id: 'since' });
      }
    }
  };

  signal.addEventListener('abort', () => pill?.remove(), { once: true });

  if (owner && repo && number) {
    const key = visitKey(owner, repo, number);
    let entry = session.get(key);
    if (!entry) {
      entry = fetchInfo({ owner, repo, number }).then((r) => {
        if (r) session.set(key, r);
        else session.delete(key);
        return r;
      });
      session.set(key, entry);
    }
    void (entry instanceof Promise ? entry : Promise.resolve(entry)).then(apply).catch((err) => debug(`Better GHub: visit tracking failed: ${String(err)}`));
  }

  return {
    showChanges(binding = null) {
      if (info?.prev && info.outcome) return go();
      toasts.show(t('prPageNoChangesSince', 'No new changes since your last visit'), { variant: 'info', binding, id: 'since' });
    },
  };
}
