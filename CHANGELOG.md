# Changelog

All notable changes to Better GHub will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-12-15

### 🎉 Initial Release

First public release of Better GHub - a Chrome extension that enhances GitHub Pull Request workflow.

### ✨ Added

#### Core Features
- **Real-time Activity Tracking** - Display last activity (comment or commit) on every PR
- **Unresolved Review Threads** - Show accurate count of unresolved review suggestions
- **Smart Batching** - Single GraphQL call for all PRs on the page (500ms debounce)
- **Parallel Processing** - REST API calls processed in parallel for instant load times
- **5-Minute Caching** - Intelligent caching to minimize API usage
- **Hover Tooltips** - Detailed breakdown of unresolved threads by author

#### Authentication
- **Personal Access Token** support for GitHub authentication
- **OAuth Device Flow** support (requires manual app registration)
- **No-Auth Mode** for public repositories (limited rate)
- **Token Validation** with automatic error handling

#### UI/UX
- **Seamless GitHub Integration** - Matches Primer design system perfectly
- **Dark Mode Support** - Full support for GitHub's dark theme
- **Loading States** - Skeleton loaders and spinners for better UX
- **Activity Icons** - Octicons for visual clarity (💬 comments, 📝 commits, ⚠️ unresolved)
- **Version Badge** - Displays extension version on GitHub pages

#### Internationalization
- **English Localization** - Complete English translations
- **Polish Localization** - Complete Polish translations (Pełna polska lokalizacja)
- **Chrome i18n API** - Proper internationalization support

#### Developer Experience
- **ES6 Modules** - Modern JavaScript with clean module structure
- **Manifest V3** - Latest Chrome extension standard
- **Modular Architecture** - Separated concerns (API, Services, UI, Utils)
- **SOLID Principles** - Clean code following DRY, KISS, YAGNI, SOLID

### 🏗️ Architecture

#### File Structure
```
src/
├── api/                    # GitHub API clients
│   ├── github-rest.js      # REST API with caching
│   └── github-graphql.js   # GraphQL with batching
├── services/               # Business logic layer
│   ├── pr-processor.js     # PR orchestration
│   └── pr-analyzer.js      # Data analysis
├── ui/                     # UI components
│   ├── activity-element.js # Activity display
│   ├── loader.js           # Loading states
│   ├── tooltip.js          # Interactive tooltips
│   └── version-badge.js    # Version indicator
├── utils/                  # Utility modules
│   ├── cache.js            # Cache management
│   ├── token-manager.js    # Token handling
│   ├── api-metrics.js      # API call tracking
│   ├── octicons.js         # Icon library
│   ├── dom-helpers.js      # DOM utilities
│   └── i18n.js             # Localization helpers
├── content.js              # Content script entry
├── background.js           # Service worker
└── constants.js            # Application constants
```

#### Key Technologies
- Chrome Extension Manifest V3
- GitHub REST API v3
- GitHub GraphQL API v4
- Chrome Storage API (local)
- Chrome i18n API
- ES6 Modules
- CSS Variables (Primer design tokens)

### 📊 Performance

- **~41 API calls for 20 PRs** (first load, then cached)
- **2 REST calls per PR** (pull request data + commits) - processed in parallel
- **1 GraphQL call total** (batched query for all unresolved counts)
- **5-minute cache** duration to minimize repeat calls
- **No rate limit throttling** - all PRs load simultaneously

### 🎨 Design

- Matches GitHub's Primer design system
- Uses GitHub CSS variables for consistency
- Responsive to GitHub's theme changes
- Dark mode automatically detected
- Native look and feel

### 🔐 Security

- Tokens stored securely in `chrome.storage.local`
- No token transmission to third parties
- Minimal permission requirements
- OAuth support with secure device flow

### 📝 Documentation

- Comprehensive README.md
- Installation guide
- Authentication setup instructions
- Development guidelines
- AI-assisted development notes

### 🤖 Development Process

This entire extension was developed using AI assistance (Claude/ChatGPT) as an after-work experiment. The codebase, architecture, testing, and documentation were created through human-AI collaboration.

---

## Upcoming Features

See [README.md Roadmap](README.md#-roadmap) for planned features.

---

## Links

- **Repository**: https://github.com/better-ghub/chrome-extension
- **Issues**: https://github.com/better-ghub/chrome-extension/issues
- **Discussions**: https://github.com/better-ghub/chrome-extension/discussions

---

[0.1.0]: https://github.com/better-ghub/chrome-extension/releases/tag/v0.1.0

