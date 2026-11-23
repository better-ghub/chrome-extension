# Chrome Web Store listing (English)

Paste each field below into the Developer Dashboard. The "Detailed description" block is plain text (the store does not render Markdown).

## Name (max 75)
Better GHub

## Short description (max 132)
Faster GitHub pull request reviews: PR inbox, smart list chips, keyboard shortcuts and a file finder. No servers, no tracking.

## Category
Developer Tools

## Single purpose
Better GHub has one purpose: to make reviewing and tracking GitHub pull requests faster. Every feature (list details and filters, the pull request inbox with notifications, keyboard shortcuts and review helpers on pull request pages) works on github.com pull requests and nothing else.

## Detailed description
Better GHub makes GitHub pull requests faster to scan, review and keep track of. It adds the missing details to the pull request list, gives you an inbox in the toolbar and puts the common review actions on the keyboard. It follows your GitHub theme (light, dark, dimmed, high contrast) and is available in English and Polish.

PULL REQUEST LIST
• Size bucket (XS to XL) with +additions / -deletions on every row
• Review state: "Your review", "Review requested" and who was asked
• Unresolved threads with a per-author breakdown, merge conflicts, last activity
• Ready and stale chips plus one-click quick filters (needs my review, ready to merge, conflicts, stale, hide drafts)
• Summary bar: "3 need your review, 2 have conflicts, 7 unresolved threads"
• Suggested labels derived from changed paths (can be turned off)

TOOLBAR INBOX
• Review requests, your pull requests and assigned pull requests with checks, review decision, conflicts and diff size
• Unread badge when someone else pushes, comments or reviews
• Desktop notifications with quiet hours
• Snooze or pin any pull request

REVIEW HELPERS ON PULL REQUEST PAGES
• Unresolved threads panel and next / previous unresolved thread
• Review progress: viewed files and threads at a glance
• Changes since your last visit
• Generated files (lockfiles and similar) collapse automatically
• File finder to jump to any changed file by name
• Toggles for whitespace and split / unified diff
• Warning when you leave with an unsubmitted review, and a quick re-review flow
• Copy branch name, a Markdown link or the checkout command

KEYBOARD SHORTCUTS
• Every action has a shortcut (Alt+C, Alt+J / K, Alt+P, Alt+1..4 and more); press Alt+/ for the cheat sheet
• All shortcuts can be recorded and remapped in the options; they never fire while you type

TOKENS AND PRIVACY
• Shortcuts work without any sign-in. List details and the inbox need a GitHub personal access token
• Add one fine-grained, read-only token per organization; the right one is chosen for each repository automatically
• Tokens are stored only in the extension's own IndexedDB and are visible only to its background service worker
• The extension talks only to github.com and api.github.com. No analytics, no tracking, no remote servers of ours
• Settings can sync through Chrome sync and be exported to a JSON file (tokens are never synced or exported)

Better GHub is open source (MIT): https://github.com/better-ghub/chrome-extension
Not affiliated with GitHub, Inc.

## Permission justifications
- storage: Saves your settings (language, feature toggles, shortcuts, notification options), the inbox state (list of your open pull requests and when you last looked at each), snooze and pin state, and a short-lived API response cache (chrome.storage.session). Settings may be synced by Chrome sync.
- alarms: Schedules the periodic inbox refresh used for the unread badge and notifications, and the periodic re-validation of stored tokens, even though the Manifest V3 service worker is not persistent.
- notifications: Shows desktop notifications for review requests and activity on your pull requests, respecting quiet hours. They can be turned off in the options.
- Host permission https://github.com/*: Runs the content script that adds chips, filters, the summary bar, shortcuts, the cheat sheet, threads panel and file tools to GitHub pull request pages and the dashboard.
- Host permission https://api.github.com/*: Lets the background service worker read pull request data (diff size, reviews, threads, checks, last activity) through GitHub's REST and GraphQL APIs, authenticated with the user's own token. This is the only external endpoint the extension contacts.
- Remote code: none. All code ships in the package; the extension pages use script-src 'self'.

## Privacy practices tab (data usage disclosure)
Privacy policy URL: https://github.com/better-ghub/chrome-extension/blob/main/PRIVACY.md

Data types to tick:
- Authentication information: YES. The user's GitHub personal access token(s), stored locally in the extension's IndexedDB and sent only to api.github.com.
- Personally identifiable information: YES (conservative). GitHub login, display name and avatar URL are cached locally to show which account is connected. Nothing leaves the browser except requests to GitHub.
- Website content: YES. Pull request metadata is read from github.com and its API to show chips, the inbox and notifications. It is processed locally and not sent anywhere else.
- Everything else (health, financial, location, web history, user activity such as clicks or keystrokes, personal communications): NO.

Certifications (all three: check):
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Plain-language summary: tokens and settings stay on the device (settings may sync through the user's own Chrome sync); the only network traffic is to GitHub; no analytics, telemetry, cookies or advertising.
