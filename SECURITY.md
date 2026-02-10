# Security Analysis - Better GHub Chrome Extension

**Last Updated:** February 10, 2026

## Overview

This document describes the security architecture of Better GHub, a Chrome Extension (Manifest V3) that enhances GitHub Pull Request workflows. The primary sensitive data handled by the extension is the **GitHub Fine-grained Personal Access Token**.

## Token Storage

- The token is stored in `chrome.storage.local` under the key `githubToken`.
- `chrome.storage.local` is isolated per extension — other extensions cannot access this data.
- Token format is validated before storage (`github_pat_` prefix, minimum 40 characters). Classic tokens (`ghp_`) are no longer accepted.
- Token is tested against the GitHub API before being accepted.
- Every `chrome.storage` read includes a `typeof === 'string'` guard before use.
- **Note:** `chrome.storage.local` is not encrypted on disk. Anyone with physical access to the machine or the browser profile can read the stored token. There is no better alternative available in Manifest V3.

## Token Transmission

- The token is sent **exclusively** in HTTP `Authorization` headers over HTTPS to `api.github.com`.
- REST API calls use the format: `Authorization: token <PAT>`
- GraphQL API calls use the format: `Authorization: bearer <PAT>`
- All API base URLs are hardcoded constants — no dynamic host construction.
- The token is **never** sent in URL query parameters.
- The token is **never** sent to any third-party server.
- `host_permissions` in `manifest.json` are restricted to `https://github.com/*` and `https://api.github.com/*`.

## Content Script Isolation

- Content scripts run in Chrome's **isolated world**, meaning the page's JavaScript on `github.com` cannot access the content script's variables, `chrome.storage.local`, or the extension's messaging APIs.
- The token stored in the module-level variable (`src/api/client.ts`) is **not accessible** from the page context.

## Inter-Component Communication

- Communication between popup, options, background service worker, and content scripts uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.
- These APIs are only accessible within the extension context — web pages cannot intercept or send messages through them.
- **The token is never transmitted in messages.** Only action strings (e.g., `tokenUpdated`, `tokenRemoved`, `tokenInvalid`, `clearCache`, `settingsUpdated`) are sent. Content scripts independently fetch the token from `chrome.storage.local` when needed.
- No `postMessage` or `externally_connectable` is used.

## Console Logging

- The token is **never** logged to the browser console — neither directly nor indirectly.
- All `console.error` statements sanitize error objects before logging, extracting only `error.message` via the pattern `error instanceof Error ? error.message : String(error)`. Raw error objects are never passed to the console.
- API endpoint paths are logged for debugging purposes, but never include authentication data.

## Extension Permissions

The extension requests minimal permissions:

| Permission | Purpose |
|---|---|
| `storage` | Store token and user preferences |
| `alarms` | Periodic token validation (every 6 hours) |
| `tabs` | Send messages to content scripts on GitHub tabs |

No dangerous permissions are used (no `<all_urls>`, `webRequest`, `cookies`, `clipboardRead`, `debugger`, etc.).

## Content Security Policy

The manifest defines an explicit CSP for extension pages:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none'"
}
```

- No `unsafe-eval` or `unsafe-inline` directives.
- All scripts are bundled locally — no external script loading.

## Content Script Scoping

Content scripts are loaded only on the pages they need:

| Script | Match Pattern | Scope |
|---|---|---|
| `content.js` | `https://github.com/*/*/pulls*` | PR list pages |
| `dashboard.js` | `https://github.com/`, `https://github.com/dashboard` | Dashboard pages only |
| `pr-shortcuts.js` | `https://github.com/*/*/pull/*` | Individual PR pages |

## External Resources

- **No external CDN, scripts, or stylesheets** are loaded. Primer CSS is bundled locally from `node_modules` into the extension.
- All `fetch()` calls target either `https://api.github.com/*` or local extension resources via `chrome.runtime.getURL()`.
- External links to `github.com/settings/personal-access-tokens/new` in popup/options pages open in new tabs with `rel="noopener noreferrer"`.

## DOM Security

All `innerHTML` assignments use only **trusted, internally-generated SVG strings** from the `Octicons.get()` utility, or hardcoded HTML templates with zero interpolated variables. Icon names are hardcoded string literals typed as a union (`IconName`), not derived from API data or user input.

All API-derived and user-facing values (PR titles, author names, comment counts, commit messages, timestamps) are inserted into the DOM using **`textContent`** or **DOM APIs** (`createElement`, `appendChild`), never `innerHTML`.

URL assignments are validated before use:
- `href` from API data (`pr.html_url`) — validated to start with `https://github.com/`; falls back to `#`
- `src` for avatar images (`user.avatar_url`) — validated to start with `https://`

## Dangerous API Usage

| Pattern | Used? | Notes |
|---|---|---|
| `eval()` / `new Function()` | No | Not used anywhere |
| `document.write()` | No | Not used anywhere |
| `postMessage` | No | Not used — no cross-origin communication |
| `localStorage` / `sessionStorage` | No | Only `chrome.storage.local` is used |
| `window.open()` | No | Not used anywhere |
| `XMLHttpRequest` | No | Only `fetch()` API is used |
| `insertAdjacentHTML` | No | Not used anywhere |
| `DOMParser` | No | Not used anywhere |
| `outerHTML` | No | Not used anywhere |
| `setTimeout` with strings | No | All calls use function references |

## GraphQL Security

GraphQL queries use **parameterized variables** for all user-supplied values (`owner`, `repo`, `number`). No string interpolation is used to embed data into query strings.

The `graphqlCall` function in `src/api/client.ts` accepts a `variables` parameter, and the values are passed separately in the JSON request body — the same pattern as SQL prepared statements.

Batch queries dynamically construct variable declarations (`$owner0`, `$repo0`, etc.), but variable **names** are generated from array indices (code-controlled integers), not from user input.

## Input Validation

- **URL parsing** (`parsePRUrl`): Uses the `URL` constructor to validate the hostname is exactly `github.com`, then applies an anchored regex (`^/...`) to extract path components.
- **Storage values**: All values from `chrome.storage.local` are type-checked before use (`typeof` guards for strings, booleans, and numbers with `isNaN` checks).
- **REST path segments**: `owner` and `repo` are encoded with `encodeURIComponent()` before interpolation into API paths.
- **Search queries**: Encoded with `encodeURIComponent()` before inclusion in API URLs.
- **Token format**: Validated for prefix and minimum length before storage and testing.
- **parseInt results**: Guarded with `isNaN()` checks where input is not regex-guaranteed numeric.

## Network Requests

All `fetch()` calls target one of two sources:

| Target | Purpose |
|---|---|
| `https://api.github.com/*` | REST and GraphQL API calls |
| `chrome.runtime.getURL(...)` | Loading extension locale files (`_locales/`) |

No user-controlled URLs are ever passed to `fetch()`.

## Threat Model Summary

| Attack Vector | Risk | Status |
|---|---|---|
| Token leak via network | None | HTTPS only, `api.github.com` only |
| Token leak to `github.com` page JS | None | Content scripts in isolated world |
| Token leak via `postMessage` | None | Not used |
| Token leak via `console.log` | None | Token never logged; errors sanitized |
| Token leak via extension messaging | None | Token not sent in messages |
| GraphQL injection | None | Uses parameterized variables |
| XSS via `innerHTML` | None | Only hardcoded SVG/HTML; API data uses `textContent` |
| External resource compromise | None | All resources bundled locally |
| URL parsing bypass | None | `URL` constructor + hostname check + anchored regex |
| Storage value type safety | None | All values type-checked before use |
| href/src from API data | None | Validated against `https://` prefix |
| REST path injection | None | Segments URL-encoded via `encodeURIComponent` |
| Token on disk (unencrypted) | Accepted | Inherent to `chrome.storage.local`, no alternative in MV3 |
| Physical machine access | Accepted | Unavoidable; standard browser extension risk |

## Conclusion

The GitHub Fine-grained Personal Access Token **will not leak** under normal usage conditions. It is not logged, not sent via `postMessage`, not accessible to page JavaScript, and is transmitted exclusively over HTTPS to GitHub's official API. All resources (CSS, scripts) are bundled locally with no external dependencies at runtime. All user input and API data is validated, type-checked, and sanitized before use. No actionable security issues were found during the audit.
