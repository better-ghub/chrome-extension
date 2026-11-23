// Better GHub - Options page: hash-routed sections, auto-saving controls.
//
// Like the popup, this page never touches the token or api.github.com: all
// GitHub work goes through the background worker.

import { icon, type IconName } from '../src/core/icons';
import { getSettings, onSettingsChanged, type Settings } from '../src/core/settings';
import { initI18n, reloadI18n, t, translatePage } from '../src/i18n';
import { request, TIMEOUT } from '../src/pages/bg';
import { SavedIndicator, setButtonBusy, isBusy } from '../src/pages/dom-ui';
import { parseRoute, type Route } from '../src/pages/route';
import { initSettingsBackup } from './backup-view';
import { AccountSection } from './account-view';
import { ChecklistView } from './checklist-view';
import { FilesView } from './files-view';
import { sendTestNotification, testNotificationMessage } from './notify-test';
import { SettingsForm } from './settings-form';
import { ShortcutsView } from './shortcuts-view';
import { TemplatesView } from './templates-view';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

/** Fill static <span data-icon="name" data-icon-size="12"> placeholders. */
function renderIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((slot) => {
    if (slot.firstElementChild) return;
    const size = Number(slot.dataset.iconSize) || 16;
    slot.replaceWith(icon(slot.dataset.icon as IconName, size));
  });
}

function setVersion(): void {
  let version = '';
  try {
    version = chrome.runtime.getManifest().version;
  } catch {
    /* not running as an extension page */
  }
  byId('version').textContent = version ? `v${version}` : '';
  byId('about-version').textContent = version ? t('optAboutVersion', 'Version $1', version) : '';
}

// ---------------------------------------------------------------- routing

let account: AccountSection;

function showRoute(route: Route, moveFocus: boolean): void {
  document.querySelectorAll<HTMLElement>('.section').forEach((section) => {
    section.hidden = section.dataset.section !== route.section;
  });
  document.querySelectorAll<HTMLAnchorElement>('.nav-item').forEach((link) => {
    if (link.dataset.nav === route.section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  account.setWelcome(route.welcome);
  if (route.addTokenFor !== undefined) {
    // One-shot: drop the owner from the URL so a reload doesn't reopen the
    // form, and so the next "Add token" click from GitHub changes the hash
    // again (and fires hashchange) even for the same owner.
    history.replaceState(null, '', '#account');
    account.openAddToken(route.addTokenFor);
    return;
  }
  if (moveFocus) {
    window.scrollTo({ top: 0 });
    const heading = route.welcome
      ? document.getElementById('hero-title')
      : document.querySelector<HTMLElement>(`.section[data-section="${route.section}"] h2[tabindex]`);
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }
}

// ------------------------------------------------------------ clear cache

function initClearCache(): void {
  const button = byId<HTMLButtonElement>('clear-cache');
  const status = new SavedIndicator();
  byId('clear-status').replaceWith(status.el);
  button.addEventListener('click', async () => {
    if (isBusy(button)) return;
    setButtonBusy(button, true, t('optClearing', 'Clearing…'));
    const res = await request('cache:clear', {}, { ok: false }, TIMEOUT.quick);
    setButtonBusy(button, false);
    if (res.ok) status.flash(t('optCleared', 'Cache cleared'));
    else status.flash(t('optClearFailed', 'Couldn’t clear the cache'), 'error');
  });
}

// ------------------------------------------------------ test notification

function initTestNotification(): void {
  const button = byId<HTMLButtonElement>('test-notification');
  const status = new SavedIndicator();
  byId('test-notification-status').replaceWith(status.el);
  button.addEventListener('click', async () => {
    if (isBusy(button)) return;
    setButtonBusy(button, true);
    const result = await sendTestNotification();
    setButtonBusy(button, false);
    status.flash(testNotificationMessage(result), result === 'sent' ? 'success' : 'error');
  });
}

// ------------------------------------------------------------------- init

async function init(): Promise<void> {
  try {
    await initI18n();
    translatePage();
  } catch {
    /* English fallbacks from the markup / t() keep the page usable */
  }
  renderIcons();
  setVersion();

  const settings: Settings = await getSettings();

  account = new AccountSection(byId('account-card'), byId('welcome'));
  account.listen();

  const shortcuts = new ShortcutsView(settings.shortcutBindings);
  shortcuts.setEnabled(settings.shortcutsEnabled);
  byId('shortcut-editor').replaceWith(shortcuts.el);

  let language = settings.language;
  const relocalize = async (): Promise<void> => {
    await reloadI18n();
    translatePage();
    setVersion();
    form.renderOptions();
    files.render();
    templates.render();
    shortcuts.render();
    await account.render();
  };

  const form = new SettingsForm(document.body, settings, async (next) => {
    language = next;
    await relocalize();
  });
  const files = new FilesView(document.body, settings, (patterns) => form.saveSetting('generatedPatterns', patterns));
  const templates = new TemplatesView(byId('snippets-editor'), settings, (snippets) => form.saveSetting('commentSnippets', snippets));
  const checklist = new ChecklistView(document.body, settings, (templates) => form.saveSetting('reviewChecklists', templates));
  initClearCache();
  initTestNotification();
  initSettingsBackup();

  onSettingsChanged((next, changed) => {
    form.sync(next);
    files.sync(next);
    templates.sync(next);
    checklist.sync(next);
    if (changed.includes('shortcutBindings')) shortcuts.sync(next.shortcutBindings);
    if (changed.includes('shortcutsEnabled')) shortcuts.setEnabled(next.shortcutsEnabled);
    if (changed.includes('language') && next.language !== language) {
      language = next.language;
      void relocalize();
    }
  });

  showRoute(parseRoute(location.hash), false);
  window.addEventListener('hashchange', () => showRoute(parseRoute(location.hash), true));
  document.body.classList.add('is-ready');

  await account.load();
}

void init().finally(() => document.body.classList.add('is-ready'));
