// Better GHub - Options: auto-saving controls bound to Settings.
//
// Controls declare their setting in markup (data-setting="key"); each gets a
// "Saved ✓" status next to it (data-saved-for="key"). Controls that only make
// sense when another switch is on declare data-depends="key".

import { h } from '../src/core/dom';
import { CACHE_DURATION_OPTIONS, NOTIFICATION_INTERVAL_OPTIONS, setSettings, STALE_DAYS_OPTIONS, type Settings } from '../src/core/settings';
import { t } from '../src/i18n';
import { SavedIndicator } from '../src/pages/dom-ui';
import { formatMinutes, plural } from '../src/pages/format';

type BoolKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

type NumericKey = 'notificationInterval' | 'cacheDuration' | 'staleDays';
type TimeKey = 'quietHoursStart' | 'quietHoursEnd';

const NUMERIC_KEYS = new Set<keyof Settings>(['notificationInterval', 'cacheDuration', 'staleDays']);
const TIME_KEYS = new Set<keyof Settings>(['quietHoursStart', 'quietHoursEnd']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECOMMENDED_CACHE = 5;

/** Option values plus the current one if it is a custom value from storage. */
export function optionValues(options: readonly number[], current: number, allowZero = false): number[] {
  return [...new Set([...options, current])]
    .filter((n) => Number.isFinite(n) && (allowZero ? n >= 0 : n > 0))
    .sort((a, b) => a - b);
}

/** "Never" / "7 days" for the stale-after select. */
export function staleDaysLabel(days: number): string {
  if (days <= 0) return t('optStaleNever', 'Never');
  return plural('optStaleDays', days, { one: '$1 day', other: '$1 days' });
}

/** All `data-depends` keys (space-separated) must be on. */
function dependsOn(el: HTMLElement, settings: Settings): boolean {
  return (el.dataset.depends ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .every((key) => settings[key as BoolKey] === true);
}

export class SettingsForm {
  private settings: Settings;
  private readonly saved = new Map<string, SavedIndicator>();

  constructor(
    private readonly root: HTMLElement,
    settings: Settings,
    /** Language needs a re-translation pass before "Saved" can be shown. */
    private readonly onLanguageChange: (language: Settings['language']) => Promise<void>
  ) {
    this.settings = settings;
    this.root.querySelectorAll<HTMLElement>('[data-saved-for]').forEach((slot) => {
      const indicator = new SavedIndicator();
      this.saved.set(slot.dataset.savedFor ?? '', indicator);
      slot.replaceWith(indicator.el);
    });
    this.renderOptions();
    this.bind();
    this.sync(settings);
  }

  /** Locale-dependent option labels (call again after a language change). */
  renderOptions(): void {
    const interval = this.root.querySelector<HTMLElement>('#interval-options');
    if (interval) {
      interval.replaceChildren(
        ...optionValues(NOTIFICATION_INTERVAL_OPTIONS, this.settings.notificationInterval).map((n) => {
          const input = h('input', {
            class: 'sr-only',
            attrs: { type: 'radio', name: 'notificationInterval', value: String(n) },
          });
          input.addEventListener('change', () => {
            if (input.checked) void this.save('notificationInterval', n);
          });
          return h('label', { class: 'segmented-item' }, input, h('span', { class: 'segmented-label', text: formatMinutes(n, 'short') }));
        })
      );
    }
    const stale = this.root.querySelector<HTMLSelectElement>('#set-stale');
    if (stale) {
      stale.replaceChildren(
        ...optionValues(STALE_DAYS_OPTIONS, this.settings.staleDays, true).map((n) =>
          h('option', { attrs: { value: String(n) }, text: staleDaysLabel(n) })
        )
      );
    }
    const cache = this.root.querySelector<HTMLSelectElement>('#set-cache');
    if (cache) {
      cache.replaceChildren(
        ...optionValues(CACHE_DURATION_OPTIONS, this.settings.cacheDuration).map((n) => {
          const text = formatMinutes(n, 'long');
          return h('option', {
            attrs: { value: String(n) },
            text: n === RECOMMENDED_CACHE ? t('optRecommended', '$1 (recommended)', text) : text,
          });
        })
      );
    }
    this.sync(this.settings);
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((control) => {
      const key = control.dataset.setting as keyof Settings;
      control.addEventListener('change', () => {
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          void this.save(key as BoolKey, control.checked);
        } else if (key === 'language') {
          void this.saveLanguage(control.value as Settings['language']);
        } else if (NUMERIC_KEYS.has(key)) {
          void this.save(key as NumericKey, Number(control.value));
        } else if (TIME_KEYS.has(key)) {
          if (TIME_RE.test(control.value)) void this.save(key as TimeKey, control.value);
          else this.sync(this.settings); // cleared / invalid: show the saved value again
        }
      });
    });
    // Radio groups (segmented controls) declare their setting per radio.
    this.root.querySelectorAll<HTMLInputElement>('input[type="radio"][data-radio-setting]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const key = radio.dataset.radioSetting as keyof Settings;
        if (key === 'checkoutCommand' && (radio.value === 'gh' || radio.value === 'git')) void this.save(key, radio.value);
      });
    });
  }

  /** Save one setting with the inline "Saved" feedback (used by custom editors). */
  saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    return this.save(key, value);
  }

  private async save<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    const indicator = this.saved.get(key);
    try {
      await setSettings({ [key]: value } as Partial<Settings>);
      this.settings = { ...this.settings, [key]: value };
      this.updateDependents();
      indicator?.flash();
    } catch {
      indicator?.flash(t('commonSaveFailed', 'Couldn’t save'), 'error');
      this.sync(this.settings);
    }
  }

  private async saveLanguage(language: Settings['language']): Promise<void> {
    try {
      await setSettings({ language });
      this.settings = { ...this.settings, language };
      await this.onLanguageChange(language);
      this.saved.get('language')?.flash();
    } catch {
      this.saved.get('language')?.flash(t('commonSaveFailed', 'Couldn’t save'), 'error');
    }
  }

  /** Reflect settings (from storage or another page) without showing "Saved". */
  sync(settings: Settings): void {
    this.settings = settings;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((control) => {
      const key = control.dataset.setting as keyof Settings;
      const value = settings[key];
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = value === true;
      else if (document.activeElement !== control) control.value = String(value);
    });
    this.root.querySelectorAll<HTMLInputElement>('input[name="notificationInterval"]').forEach((radio) => {
      radio.checked = Number(radio.value) === settings.notificationInterval;
    });
    this.root.querySelectorAll<HTMLInputElement>('input[type="radio"][data-radio-setting]').forEach((radio) => {
      radio.checked = String(settings[radio.dataset.radioSetting as keyof Settings]) === radio.value;
    });
    this.updateDependents();
  }

  /**
   * Disable controls whose switch is off. Groups may nest (quiet hours inside
   * desktop notifications) and list several keys: a control is enabled only
   * when every group around it is on.
   */
  private updateDependents(): void {
    const groups = [...this.root.querySelectorAll<HTMLElement>('[data-depends]')];
    const off = groups.filter((el) => !dependsOn(el, this.settings));
    for (const el of groups) {
      const on = !off.includes(el);
      el.classList.toggle('is-disabled', !on);
      el.querySelectorAll('.segmented').forEach((seg) => seg.classList.toggle('is-disabled', !on));
      el.querySelectorAll<HTMLElement>('[data-depends-note]').forEach((note) => {
        note.hidden = on;
      });
    }
    for (const el of groups) {
      el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((c) => {
        c.disabled = off.some((g) => g.contains(c));
      });
    }
  }
}
