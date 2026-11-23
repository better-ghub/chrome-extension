# Privacy Policy for Better GHub Chrome Extension

**Last Updated:** November 22, 2026

## Overview

Better GHub is a Chrome extension that enhances GitHub pull requests: activity details in pull request lists, keyboard shortcuts on pull request pages, a pull request inbox in the toolbar popup and a dashboard card. We take your privacy seriously and are committed to protecting your data.

## Data Collection

Better GHub collects and stores minimal data necessary for its functionality:

### Authentication Information

- **GitHub personal access token(s)**: You provide one or more tokens of your GitHub account (for example one fine-grained token per organization) to authenticate with GitHub's API. They are stored locally in your browser, in the extension's own IndexedDB, and are never transmitted anywhere except GitHub's API (`api.github.com`).
- **Who can read them**: Only the extension's background service worker. The popup and options pages ask it to add or remove tokens, and the scripts that run on github.com pages ask it to make API calls on their behalf — none of them ever receives a token.
- **Token details**: For each token the extension keeps its type, its last four characters, which organizations it can read, and its expiry date, so the options page can show them.
- **Account details**: Your GitHub login, display name, avatar URL and profile URL are cached locally so the popup can show which account is connected.

### User Preferences

- Language, feature toggles, keyboard shortcut bindings, notification settings and cache duration.
- These preferences are stored in your browser. If you are signed in to Chrome with sync enabled, Chrome may sync them between your profiles through your Google account (`chrome.storage.sync`); they never go to any server of ours. GitHub tokens are never synced or exported.
- You can export your settings to a JSON file and import them again from the options page; the file contains settings only.

### Pull request data

- **Inbox state**: The list of open pull requests you authored, were asked to review or are assigned to, plus the time you last looked at each one (used for the unread badge). Stored locally in `chrome.storage.local`.
- **Response cache**: Recent GitHub API responses are cached in `chrome.storage.session` for a few minutes (configurable) to save API quota. This cache lives in memory and is cleared when the browser closes, or immediately with "Clear cached data" in the options.

## How We Use Data

- **GitHub token**: Used exclusively to authenticate requests to GitHub's official REST and GraphQL APIs to read pull request data (diff size, review requests, review threads, last activity, checks status) for the pages you visit and for your inbox.
- **User Preferences**: Used to customize the extension's behavior according to your settings.

## Data Storage

- All data is stored **locally in your browser** using Chrome's storage API
- No data is transmitted to external servers except official GitHub API endpoints
- No analytics, tracking, or telemetry is collected
- No cookies are used

## Data Sharing

- We do **NOT** sell, trade, or transfer your data to third parties
- We do **NOT** use your data for advertising or marketing purposes
- Your GitHub token is only sent to GitHub's official API endpoints (`api.github.com` and `github.com`)
- No data is shared with developers or any third-party services

## Third-Party Services

The extension communicates only with:

- **GitHub API** (`api.github.com`) - To fetch Pull Request information using your provided token
- **GitHub Website** (`github.com`) - Where the extension operates

## Data Security

- Your tokens are stored in the extension's own IndexedDB, which is isolated from websites and other extensions. Note that it is not encrypted at rest — anyone with access to your browser profile on disk could read it, as with any locally stored credential.
- We recommend a fine-grained token with read-only access (Pull requests: Read, Metadata: Read).
- The extension requests only the `storage`, `alarms` and `notifications` permissions (desktop notifications appear only after you turn them on in the options) plus access to `github.com` and `api.github.com`.
- The extension follows Chrome Web Store security best practices
- All communication with GitHub uses HTTPS encryption

## Your Rights

You can:

- **View your data**: See your preferences and the details of each stored token (type, last four characters, organizations, expiry) on the extension's options page
- **Delete your data**: Remove your token at any time through the extension's popup or options page
- **Export your data**: Export your preferences to a JSON file from the options page (About section). Tokens are never exported; they stay in the extension's IndexedDB
- **Uninstall**: Uninstalling the extension will delete all stored data
- **Use without authentication**: Keyboard shortcuts on pull request pages work without a token; list details, the inbox and the dashboard card need one

## Data Retention

- Data is retained only as long as the extension is installed
- Upon uninstallation, all data is automatically deleted by Chrome
- You can remove a single token or sign out (removing all of them) at any time in the popup or options page. Revoke tokens on GitHub as well if you no longer need them.

## Children's Privacy

This extension is not directed to children under 13 and we do not knowingly collect data from children.

## International Data Transfers

Your data is stored locally on your device. When you use the extension:

- Your GitHub token is sent only to GitHub's servers (located per GitHub's infrastructure)
- No data is transferred to the extension developers or any third parties

## Changes to This Policy

We may update this privacy policy from time to time. The "Last Updated" date at the top will reflect any changes. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Open Source

This extension is open source and available under the MIT License. You can review the complete source code at:

**GitHub Repository:** https://github.com/better-ghub/chrome-extension

This transparency allows anyone to verify our privacy practices.

## Contact

For questions about this privacy policy or the extension:

- **GitHub Repository**: https://github.com/better-ghub/chrome-extension
- **Issues**: https://github.com/better-ghub/chrome-extension/issues
- **Discussions**: https://github.com/better-ghub/chrome-extension/discussions

## Compliance

This extension complies with:

- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)

## Consent

By installing and using Better GHub, you consent to this privacy policy.

## Your Consent Choices

You have the right to:

- Choose whether to provide a GitHub token (extension works with limited functionality without it)
- Revoke access at any time by removing your token
- Request information about data stored by the extension
- Have your data deleted (by removing the token or uninstalling)

---

**This extension is developed entirely using AI assistance as a fun after-work experiment and is maintained by the open-source community.**

