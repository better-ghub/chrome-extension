# Privacy Policy for Better GHub Chrome Extension

**Last Updated:** December 16, 2024

## Overview

Better GHub is a Chrome extension that enhances GitHub's Pull Request pages by displaying real-time activity information and unresolved review thread counts. We take your privacy seriously and are committed to protecting your data.

## Data Collection

Better GHub collects and stores minimal data necessary for its functionality:

### Authentication Information

- **GitHub Fine-grained Personal Access Token or OAuth Token**: You provide this token to authenticate with GitHub's API. The token is stored locally in your browser using Chrome's storage API and is never transmitted to any third-party servers.
- **Storage Location**: All tokens are stored locally in your browser's secure storage (`chrome.storage.local`).

### User Preferences

- **Cache Duration**: Your preferred cache time for PR data
- **Batch Delay**: Your preferred API batch delay setting
- These preferences are stored locally in your browser.

## How We Use Data

- **GitHub Fine-grained Token**: Used exclusively to authenticate API requests to GitHub's official REST and GraphQL APIs to fetch Pull Request data, commit information, and review thread counts.
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

- Your authentication token is stored securely using Chrome's built-in storage API
- The token is encrypted by Chrome's security mechanisms
- The extension follows Chrome Web Store security best practices
- All communication with GitHub uses HTTPS encryption

## Your Rights

You can:

- **View your data**: Access your stored token and preferences through the extension's options page
- **Delete your data**: Remove your token at any time through the extension's popup or options page
- **Export your data**: Your token and preferences are standard JSON format in Chrome storage
- **Uninstall**: Uninstalling the extension will delete all stored data
- **Use without authentication**: Use the extension without a token (for public repositories only, with limited functionality)

## Data Retention

- Data is retained only as long as the extension is installed
- Upon uninstallation, all data is automatically deleted by Chrome
- You can manually delete your token at any time without uninstalling

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

