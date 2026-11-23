# Chrome Web Store submission

Everything needed to submit Better GHub. Nothing here is uploaded automatically.

## 1. Build the package

```bash
npm run check      # typecheck, lint, tests, build
npm run package    # builds dist/ and zips it to better-ghub.zip
```

Upload `better-ghub.zip` (Developer Dashboard > Package). The version comes from `manifest.json`.

## 2. Regenerate the images (optional)

```bash
npm run store:assets
```

Renders the PNGs below from `e2e/shots/` and `icons/icon.svg` with Chrome for Testing (`npm run e2e:install` once). Re-run `npm run e2e` first if the UI changed, so the screenshots are current.

| File | Size | Store field |
|---|---|---|
| `screenshots/01..05-*.png` | 1280x800 | Store listing > Screenshots (default language, English text) |
| `screenshots/pl/01..05-*.png` | 1280x800 | Same slots in the Polish localization |
| `promo/small-tile-440x280.png` | 440x280 | Small promotional tile |
| `promo/marquee-1400x560.png` | 1400x560 | Marquee promotional tile |

Store icon (128x128): `icons/icon128.png` (already in the package).

Note: the captured UI inside the screenshots is Polish (the e2e harness runs with the Polish UI language). Only the headlines differ between the English and Polish sets. Recapture the shots with the English UI if you want fully English screenshots.

## 3. Listing text

- `listing.en.md`: default language (English). Name, short description, detailed description, category, single purpose.
- `listing.pl.md`: Polish localization (add it under "Store listing" > language > Polish).

## 4. Where to paste what

| Dashboard tab | Field | Source |
|---|---|---|
| Store listing | Description, short description, category | `listing.*.md` |
| Store listing | Screenshots, tiles | `screenshots/`, `promo/` |
| Privacy | Single purpose description | `listing.en.md` > Single purpose |
| Privacy | Permission justifications (storage, alarms, notifications, two host permissions, remote code) | `listing.en.md` > Permission justifications |
| Privacy | Data usage checkboxes and certifications | `listing.en.md` > Privacy practices |
| Privacy | Privacy policy URL | https://github.com/better-ghub/chrome-extension/blob/main/PRIVACY.md |
| Distribution | Visibility, regions | your choice |

The extension name and description inside the package come from `_locales/*/messages.json` (`extensionName`, `extensionDescription`). The store shows these when it reads the manifest, so keep `extensionDescription` at or below 132 characters and in sync with the short description.

## 5. Pre-submit checklist

- [ ] `npm run check` passes and `better-ghub.zip` is built from a clean `dist/`
- [ ] Version in `manifest.json`, `package.json` and `SECURITY.md` matches
- [ ] `PRIVACY.md` is published on the default branch and lists the `notifications` permission
- [ ] Manifest descriptions in `_locales/en` and `_locales/pl` describe the current features
- [ ] Screenshots reviewed, no real tokens or private repositories visible
- [ ] Single purpose, permission justifications and data-usage answers pasted
- [ ] Test instructions (reviewers): the extension works without a token on any pull request page (press Alt+/); list details and inbox need a GitHub token, which reviewers can create read-only at github.com/settings/personal-access-tokens
- [ ] Submit for review and choose staged or immediate publishing
