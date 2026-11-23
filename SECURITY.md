# Security Architecture

**Version:** 0.4.0

This document describes the security architecture of Better GHub, a Chrome extension (Manifest V3) that enhances GitHub pull request workflows. The sensitive data it handles are **GitHub personal access tokens** (fine-grained or classic). Everything else it stores is preferences and pull request metadata that GitHub already shows the user.

## Trust boundaries

| Context | Trust | Can read tokens? | Talks to GitHub API? |
|---|---|---|---|
| Background service worker | Trusted | **Yes — the only one** | Yes, the only one |
| Popup / options pages (`chrome-extension://`) | Trusted | No (asks the background) | No |
| Content script on `github.com` (isolated world) | Semi-trusted | No | No (asks the background) |
| `github.com` page JavaScript | Untrusted | No | — |

Messages from content scripts are treated as untrusted input by the background (Chrome recommends this, because a compromised renderer can forge them).

## Token storage

- Tokens are stored **only in the background service worker's IndexedDB** (database `bghub`, object store `secrets`), which lives in the extension's own origin. Content scripts run in `github.com`'s origin and cannot open it; they also never receive it through `chrome.storage.onChanged`, because tokens are not in `chrome.storage` at all.
- Tokens from older versions (stored in `chrome.storage.local['githubToken']`) are moved into IndexedDB once on install/update/startup and deleted from `chrome.storage.local`.
- Non-secret token metadata (kind, last 4 characters, which owners a token covers, expiry, problems) and the account (login, name, avatar URL) are kept in `chrome.storage.local`.
- **Not encrypted at rest.** IndexedDB, like `chrome.storage`, is not encrypted on disk; anyone with access to the browser profile can read it. Users should create **read-only, expiring** fine-grained tokens (the options page links to a pre-filled form with `pull_requests=read`, `metadata=read`, `contents=read`, 90-day expiry).

### Several tokens

A fine-grained token can read private repositories of exactly one owner (the user or one organization) plus all public repositories. Users can therefore store several tokens **for the same GitHub account** (a token for another account is rejected). For each request the background picks the token that covers the repository owner, falls back to the other tokens on access errors and remembers which one worked. Tokens are never sent to an owner other than through `api.github.com`; routing only changes *which* of the user's own tokens authenticates a request.

## Token validation

- Format check before any network call (`github_pat_`, `ghp_`, `gho_`, `ghu_`, `ghs_`).
- `GET /user` with the new token before it is stored.
- Periodic re-validation (alarm, every 6 hours). A token is marked invalid only on a real `401`; network errors, 5xx and rate limits never sign the user out.

## Token transmission

- Sent **only** by the background, **only** in the `Authorization: Bearer` header, **only** over HTTPS to `https://api.github.com`.
- Never in URLs, never in messages to other contexts, never in responses returned to popup/options/content scripts, never logged (error texts pass through `redactSecrets()` as defence in depth).

## API proxy (background)

Content scripts and pages reach GitHub only through typed messages (`src/core/messages.ts`):

- **Sender check:** messages are accepted only from this extension (`sender.id`). Token-changing requests (`auth:setToken`, `auth:removeToken`, `auth:logout`) are accepted only from extension pages, not from content scripts.
- **REST:** `GET` only; the path must start with a single `/`, is resolved against `https://api.github.com`, and absolute URLs, `//`, backslashes and whitespace are rejected.
- **GraphQL:** requests from content scripts must be read-only: after stripping comments and string literals the document must start with `query` and must not contain `mutation` or `subscription`. All values are passed as GraphQL variables, never interpolated into the query text.
- **Rate limits:** budgets are tracked per resource (`core`, `graphql`, `search`); a `403`/`429` is treated as a rate limit only when GitHub says so (`x-ratelimit-remaining: 0`, `retry-after`, or a rate-limit message). Concurrency is capped.
- **Cache:** responses are cached in `chrome.storage.session` (memory, trusted contexts only, cleared when the browser closes), keyed per token.

## Content scripts

- One content script (`content.js`) on `https://github.com/*`, running in Chrome's isolated world; page JavaScript cannot reach its variables or extension APIs.
- It never holds a token and never calls `fetch` against the GitHub API.
- All API- and page-derived text is inserted with `textContent` / DOM APIs. `innerHTML` is used only for static octicon SVG strings generated at build time from `@primer/octicons`.
- Floating UI uses the browser top layer (`popover`, `<dialog>`), not page-wide event hooks; everything is removed when the user navigates away.

## Extension permissions

| Permission | Purpose |
|---|---|
| `storage` | Preferences, token metadata, inbox state, session cache |
| `alarms` | Inbox refresh and periodic token validation |
| Host `https://github.com/*` | The content script |
| Host `https://api.github.com/*` | GitHub REST and GraphQL API |

No `tabs`, `<all_urls>`, `webRequest`, `cookies`, `scripting`, `debugger` or clipboard-read permissions. (Copying a branch name or link uses the page's own clipboard API after a user keystroke.)

## Content Security Policy

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none'"
}
```

No `unsafe-eval` / `unsafe-inline`; all scripts and styles are bundled locally. No external fonts, CDNs or analytics.

## Other storage

- Popup `localStorage` holds two UI conveniences only (last selected inbox tab, last known signed-in state for the loading placeholder). No tokens, no API data.
- Content scripts read `localStorage['bghub-debug']` on github.com to enable verbose logging; nothing is written there.

## Risk summary

| Risk | Status | Mitigation |
|---|---|---|
| Token leak to github.com page JS | Mitigated | Isolated world; token never in content scripts |
| Token leak to content scripts via storage events | Mitigated | Token stored in the background's IndexedDB, not `chrome.storage` |
| Content script abusing the API proxy to write | Mitigated | Read-only GraphQL and GET-only REST for content scripts |
| Proxy used to reach other hosts | Mitigated | Fixed origin `https://api.github.com`, strict path validation |
| Token in logs | Mitigated | Never logged; `redactSecrets()` on error texts |
| XSS via API data | Mitigated | `textContent` only; no `innerHTML` with dynamic data |
| Over-privileged token | User choice | Pre-filled read-only fine-grained token recommended; classic tokens allowed but flagged as broad |
| Token on disk (unencrypted) | Accepted | Inherent to browser storage; use read-only, expiring tokens |

## Reporting a vulnerability

Please open a private security advisory on the repository, or an issue without sensitive details if advisories are unavailable.
