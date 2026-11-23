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

The English set is rendered from `e2e/shots/en/` and the Polish set from `e2e/shots/pl/`; capture them with `E2E_LANG=en npm run e2e` and `E2E_LANG=pl npm run e2e`. Real author names and avatars from the live GitHub pages are replaced with fictional ones before each screenshot (`e2e/anonymize.js`).

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

## 6. Automated releases (GitHub Actions)

`.github/workflows/release.yml` runs on every pushed tag `v*`: it checks that the tag matches `manifest.json` and `package.json`, runs `npm run check`, builds `better-ghub-<version>.zip`, attaches it to a GitHub release and, in the `chrome-web-store` job, uploads it to the store and submits it for review (`scripts/cws-publish.js`, Chrome Web Store API v2).

One-time setup:

1. The item must already exist in the store: the API cannot create items or edit the listing, so the first version and every listing change go through the dashboard.
2. Google Cloud: create a project, enable the **Chrome Web Store API**, create a service account and download a JSON key.
3. Developer Dashboard > **Account**: add the service account's e-mail (one per publisher).
4. GitHub > Settings > Environments > `chrome-web-store`: deployments are limited to `v*` tags and need a required reviewer's approval. Add these as **environment** secrets there (never as repository secrets, which every workflow on any branch could read):
   - `CWS_SERVICE_ACCOUNT_KEY`: the whole JSON key
   - `CWS_PUBLISHER_ID`: Developer Dashboard > Publisher > Settings
   - `CWS_ITEM_ID`: the 32-character extension ID
5. Keep secret scanning and push protection on (Settings > Code security) so a key can't be pushed to this public repository by accident.

Release a new version:

```bash
# bump "version" in manifest.json and package.json (and SECURITY.md), merge to main, then
git tag v0.4.1 && git push origin v0.4.1
```

Without the secrets the workflow still builds the release and skips the store step with a warning. Locally, `CWS_SERVICE_ACCOUNT_KEY_FILE=… CWS_PUBLISHER_ID=… CWS_ITEM_ID=… npm run store:publish` does the same upload.
