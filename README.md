<div align="center">

# 🚀 Better GHub

### A sharper GitHub pull request workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-MV3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Version](https://img.shields.io/badge/version-0.4.0-green.svg)](https://github.com/better-ghub/chrome-extension/releases)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/better-ghub/hblfaadiojnkmlklakmlehpechkoobgl)

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/better-ghub/hblfaadiojnkmlklakmlehpechkoobgl)**

[Features](#-features) • [Keyboard shortcuts](#-keyboard-shortcuts) • [Installation](#-installation) • [Development](#-development) • [License](#-license)

</div>

---

## 🤖 About This Project

> **This extension is developed entirely using AI assistance as a fun after-work experiment.**
>
> The entire codebase, architecture, and documentation were created through conversations with AI. This project serves as an exploration of what's possible when humans and AI collaborate on software development. We encourage you to fork, modify, and develop this project using AI tools in a similar way!

---

## ✨ Features

Everything is drawn with GitHub's own design tokens, so it follows your GitHub theme — light, dark, dimmed, high contrast and colorblind — and respects *reduced motion*.

### Pull request list
Under every pull request in `/{owner}/{repo}/pulls`:

- **Size** — `XS … XL` bucket with `+additions −deletions` (hover for the number of files).
- **Review state** — *Your review* (highlighted row) when you are a requested reviewer, otherwise *Review requested · 2d* with the reviewers on hover.
- **Unresolved threads** — count with a per-author breakdown on hover (outdated threads included and flagged).
- **Merge conflicts**.
- **Last activity** — who commented / pushed / reviewed and when.
- **Suggested labels** — derived from the changed paths (`needs tests`, `docs`, `CI`, `dependencies`, …). Can be turned off.
- **Summary bar** above the list: *3 need your review · 2 have conflicts · 7 unresolved threads*, with a one-click *review requested* filter.

All rows are fetched with **one batched GraphQL request per 10 pull requests** (the 0.3 version made ~4 REST calls per row), cached for a few minutes and re-applied instantly when GitHub re-renders the list.

### Pull request page
- **Keyboard shortcuts** for collapsing threads and files, jumping between unresolved threads, switching tabs and copying the branch name or a Markdown link — see below.
- **Cheat sheet** (`⌥/`) and a small floating keyboard button.
- **Toasts** that confirm what a shortcut did (*Collapsed 9 files*).

### Toolbar popup — your pull request inbox
- **Review requests**, **your pull requests** and **assigned** pull requests with checks, review decision, conflicts, unresolved threads and diff size.
- **Unread badge** on the toolbar icon when someone else pushes, comments or reviews (your own activity never counts).
- Quick toggles for shortcuts and notifications.

### Dashboard
- A **Your pull requests** card on the github.com home page.

### Options
- Account, per-feature switches, a **shortcut editor** (record any combination, conflict detection, reset), notification interval, cache duration, language (English / Polski).
- Settings sync across your Chrome profiles through `chrome.storage.sync` (values too large for sync, or a failed sync write, stay local automatically). Tokens never sync. **Export / Import** (About) saves and restores settings as `better-ghub-settings.json`.

---

## ⌨️ Keyboard shortcuts

Shortcuts work on any pull request page and never fire while you are typing. All of them can be remapped in **Options → Keyboard shortcuts**. On macOS `Alt` is `⌥ Option`.

| Shortcut | Action | Where |
|---|---|---|
| `Alt+C` | Collapse / expand all review threads (inline comments on *Files changed*) | Conversation, Files changed |
| `Alt+Shift+F` | Collapse / expand all files | Files changed |
| `Alt+J` / `Alt+K` | Next / previous unresolved thread | Conversation, Files changed |
| `Alt+1` … `Alt+4` | Conversation / Commits / Checks / Files changed | Any PR tab |
| `Alt+B` | Copy the head branch name | Any PR tab |
| `Alt+L` | Copy `[Title (#123)](url)` | Any PR tab |
| `Alt+/` | Show all shortcuts | Any PR tab |

Shortcuts match the **physical key** (`KeyboardEvent.code`), so `⌥C` works on a Mac even though it types `ç`. When items are in a mixed state, a toggle brings everything to one state: if anything is expanded it collapses all, otherwise it expands all.

---

## 📦 Installation

### From the Chrome Web Store

Install **[Better GHub from the Chrome Web Store](https://chromewebstore.google.com/detail/better-ghub/hblfaadiojnkmlklakmlehpechkoobgl)**. It updates automatically. The options page opens on first install, where you can connect a GitHub token (or do it later from the toolbar popup).

### From source

```bash
git clone https://github.com/better-ghub/chrome-extension.git
cd chrome-extension
npm ci
npm run build
```

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the **`dist/`** folder.
3. The options page opens on first install — connect a GitHub token there or in the popup.

### GitHub tokens

Keyboard shortcuts work without a token. The list details, inbox, badge and dashboard card need one.

A **fine-grained** token can read the private repositories of exactly **one owner** — you or one organization — plus every public repository. Better GHub therefore lets you add **one token per organization** to the same account and picks the right one for every repository automatically:

1. **Options → Account → Add a token for another organization**, type the organization (e.g. `acme`) and click **Create token on GitHub** — the form opens pre-filled with that organization, read-only permissions (*Pull requests*, *Metadata*, *Contents*) and a 90-day expiry.
2. Paste the token back. The list shows which organizations each token covers, when it expires, and problems such as *pending organization approval* or *SSO authorization needed*.
3. On a pull request list the extension can't read, the bar above the list offers **Add token for `<org>`** — one click to the same pre-filled flow.

A **classic** token (`ghp_…`) covers every organization at once but grants write access to all your repositories; it is supported, not recommended.

Tokens never leave the background service worker; scripts running on github.com never see them. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

---

## 🛠️ Development

```bash
npm run build:watch   # rebuild dist/ on change (inline sourcemaps)
npm run check         # typecheck + lint + tests + production build
npm run package       # production build zipped to better-ghub.zip
npm run store:assets  # Chrome Web Store screenshots and promo tiles (see store/README.md)
```

After a rebuild, click **Reload** on the extension card in `chrome://extensions/` and refresh GitHub. Add `localStorage['bghub-debug'] = '1'` on github.com for verbose logs.

### End-to-end tests

```bash
npm run e2e:install   # once: downloads Chrome for Testing (branded Chrome ignores --load-extension)
npm run e2e           # build, then every spec in light and dark
node e2e/run.js pr-list --light   # one spec, light only; HEADED=1 shows the browser
E2E_LANG=en npm run e2e        # pin the extension UI language; screenshots go to e2e/shots/en/
```

The specs in `e2e/` load `dist/` into Chrome for Testing, open live public github.com pages while logged out, and replace `api.github.com` with a deterministic fake inside the extension's service worker (`e2e/fake-github.js`), so no token is needed. Screenshots land in `e2e/shots/`. GitHub changes its markup without notice, so a failure there can be GitHub rather than the extension; the specs are not part of CI for that reason. Set `CHROME_PATH` to use another Chromium build.

### Architecture

```
src/
├── content/index.ts        # single content script for github.com/*: boots settings + i18n, starts the router
├── core/
│   ├── router.ts           # SPA router — mounts features per URL with an AbortSignal for cleanup
│   ├── page.ts             # URL → page kind (PR, PR list, dashboard) and PR tab
│   ├── messages.ts         # typed contract between content scripts, popup/options and the background
│   ├── settings.ts         # every stored preference: keys, defaults, validation
│   ├── dom.ts / icons.ts   # tiny h() element factory, observers, octicons (generated subset)
├── features/
│   ├── pr-page/            # shortcuts, toasts, cheat sheet, floating hint
│   ├── pr-list/            # batched GraphQL query, analysis, row chips, summary bar
│   └── dashboard/          # "Your pull requests" card
├── background.ts + background/  # token owner: API proxy, cache, rate limits, auth, inbox + badge, alarms
├── shortcuts.ts            # shortcut registry, matching, formatting, storage
├── i18n.ts                 # user-selectable language (en / pl)
├── ui/                     # shared tooltip (Popover API), time + plural helpers
└── styles/                 # injected CSS, built on GitHub Primer variables
popup/ options/ src/pages/  # extension pages
```

Key decisions:

- **One content script + router** instead of one script per URL pattern: GitHub navigates client-side, so per-URL scripts were never injected after soft navigations.
- **Shortcuts are page-level** (no `chrome.commands`): the manifest command duplicated the page listener and could not be remapped from Options.
- **The background owns the tokens** (IndexedDB, never `chrome.storage`) and is the only place that talks to GitHub; it routes each request to the token that covers the repository owner, caches responses, tracks rate-limit budgets per resource, and treats a 403 as a rate limit only when GitHub says so.
- **No z-index wars**: floating UI uses the browser top layer (`popover`, `<dialog>`).

### Adding an icon

Add the octicon name to `ICONS` in `scripts/gen-icons.js` and run `npm run gen:icons`.

### Translations

Strings live in `_locales/en/messages.json` and `_locales/pl/messages.json`. In code use `t('key', 'English fallback', substitutions)`.

---

## 🤝 Contributing

1. Fork the repository and create a feature branch.
2. Make your changes — feel free to use AI tools and document interesting prompts.
3. Run `npm run check` and test in Chrome in both light and dark GitHub themes.
4. Open a pull request.

Guidelines: keep modules small, add translations for both locales, use the `--bghub-*` CSS tokens instead of hard-coded colors, and clean up everything a feature adds when its `AbortSignal` fires.

---

## 🐛 Known limitations

- GitHub changes its markup often. The list uses stable `data-testid` hooks, but a redesign can still break an enhancement until it is updated.
- "Your review" covers review requests addressed to you directly, not to one of your teams.
- The new React *Files changed* experience (opt-in on GitHub) is supported on a best-effort basis.

---

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2024 Better GHub Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- **GitHub** for their excellent API and the Primer design system
- **The AI Community** for making tools that enable projects like this
- **Open Source Contributors** who inspire collaborative development

---

<div align="center">

**Made with 🤖 AI assistance and ❤️ for the open source community**

If you find this project useful, please consider giving it a ⭐ on GitHub!

</div>
