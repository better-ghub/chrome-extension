// Better GHub - Options: export / import of settings (About section).

import { getSettings, setSettings } from '../src/core/settings';
import { t } from '../src/i18n';
import { SavedIndicator } from '../src/pages/dom-ui';
import { EXPORT_FILENAME, parseSettingsFile, serializeSettings, type ParseError } from '../src/pages/settings-io';

export function importErrorMessage(error: ParseError): string {
  switch (error) {
    case 'invalid-json':
      return t('optImportInvalidJson', 'That file isn’t valid JSON.');
    case 'wrong-app':
      return t('optImportWrongApp', 'That isn’t a Better GHub settings file.');
    case 'too-large':
      return t('optImportTooLarge', 'That file is too large to be a settings file.');
    default:
      return t('optImportEmpty', 'That file has no settings to import.');
  }
}

function version(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '';
  }
}

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Wire the export button, the import button + hidden file input and their status lines. */
export function initSettingsBackup(root: ParentNode = document): void {
  const exportBtn = root.querySelector<HTMLButtonElement>('#export-settings');
  const importBtn = root.querySelector<HTMLButtonElement>('#import-settings');
  const input = root.querySelector<HTMLInputElement>('#import-file');
  const exportSlot = root.querySelector<HTMLElement>('#export-status');
  const importSlot = root.querySelector<HTMLElement>('#import-status');
  if (!exportBtn || !importBtn || !input || !exportSlot || !importSlot) return;

  const exportStatus = new SavedIndicator();
  const importStatus = new SavedIndicator();
  exportSlot.replaceWith(exportStatus.el);
  importSlot.replaceWith(importStatus.el);

  exportBtn.addEventListener('click', async () => {
    try {
      download(serializeSettings(await getSettings(), version()), EXPORT_FILENAME);
      exportStatus.flash(t('optExported', 'Settings exported'));
    } catch {
      exportStatus.flash(t('optExportFailed', 'Couldn’t export the settings'), 'error');
    }
  });

  importBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const result = parseSettingsFile(await file.text());
      if (!result.ok) {
        importStatus.flash(importErrorMessage(result.error), 'error');
        return;
      }
      await setSettings(result.settings);
      importStatus.flash(t('optImported', 'Imported $1 settings', String(result.count)));
    } catch {
      importStatus.flash(t('optImportFailed', 'Couldn’t import the settings'), 'error');
    }
  });
}
