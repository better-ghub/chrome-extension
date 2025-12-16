<div align="center">

# 🚀 Better GHub

### Enhance your GitHub Pull Request workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://www.google.com/chrome/)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://github.com/better-ghub/chrome-extension/releases)

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Contributing](#-contributing) • [License](#-license)

</div>

---

## 🤖 About This Project

> **This extension is developed entirely using AI assistance as a fun after-work experiment.**
> 
> The entire codebase, architecture, and documentation were created through conversations with AI. This project serves as an exploration of what's possible when humans and AI collaborate on software development. We encourage you to fork, modify, and develop this project using AI tools in a similar way!

---

## ✨ Features

**Better GHub** transforms your GitHub Pull Request experience by providing instant insights directly on PR list pages:

### 🎯 Core Features

- **📊 Real-time Activity Tracking**
  - See the last activity on every PR at a glance
  - Track whether it was a comment or commit
  - View commit titles and author information
  - Always visible - no clicking required!

- **⚠️ Unresolved Review Threads**
  - Accurate count of unresolved review suggestions
  - Detailed breakdown by author on hover
  - Uses GitHub GraphQL API for precision

- **⚡ Smart Performance**
  - Intelligent batching: 1 GraphQL call for all PRs
  - 5-minute caching to minimize API usage
  - Parallel processing for instant load times
  - ~41 API calls for 20 PRs (then cached)

- **🎨 Seamless Integration**
  - Matches GitHub's Primer design system
  - Full dark mode support
  - Native look and feel
  - No UI disruption

- **🌍 Bilingual Support**
  - English and Polish localization
  - Uses Chrome i18n API
  - Easy to extend with more languages

### 🔐 Authentication Options

- **Personal Access Token** (Recommended): Quick setup, full control
- **OAuth Support**: Enterprise-ready authentication
- **No Token Mode**: Works with public repos (limited rate)

---

## 📦 Installation

### Prerequisites

- Google Chrome or Chromium-based browser
- GitHub account (optional for public repos)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/better-ghub/chrome-extension.git
   cd chrome-extension
   ```

2. **Generate extension icons** (one-time setup)
   - Open `generate-icons.html` in your browser
   - Click "Download All Icons"
   - Icons will be saved to the `icons/` folder

3. **Load in Chrome**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right)
   - Click **Load unpacked**
   - Select the `BetterGithubPR` folder

4. **Configure authentication** (optional but recommended)
   - Click the extension icon in your toolbar
   - Follow the setup wizard to add your GitHub token
   - See [Authentication Guide](#-authentication) below

---

## 🔑 Authentication

### Option A: Personal Access Token (Recommended)

1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. Click **Generate new token** → **Generate new token (classic)**
3. Select scopes:
   - `public_repo` - for public repositories only
   - `repo` - for private repositories (includes public)
4. Copy the token and paste it in the extension popup

**Rate Limits:**
- With token: 5,000 requests/hour
- Without token: 60 requests/hour

### Option B: No Authentication

The extension works with public repositories without authentication, but with reduced rate limits.

---

## 🎮 Usage

1. **Navigate to any PR list page**
   ```
   https://github.com/{owner}/{repo}/pulls
   ```

2. **View enhanced information**
   - Activity indicators appear below each PR title
   - Unresolved thread counts show as yellow badges
   - Hover over badges for detailed breakdowns

3. **Customize settings**
   - Click the extension icon
   - Access the options page
   - Configure cache duration and other preferences

### Visual Examples

**Last Activity Display:**
```
💬 Last comment by johndoe
📝 Last commit by janedoe: "Fix authentication bug"
```

**Unresolved Threads:**
```
⚠️ Unresolved suggestions (3)
   [Hover to see breakdown by author]
```

---

## 🏗️ Architecture

**Better GHub** uses modern Chrome Extension Manifest V3 with a clean, modular architecture:

```
src/
├── api/                    # GitHub API clients
│   ├── github-rest.js      # REST API with caching
│   └── github-graphql.js   # GraphQL with batching
├── services/               # Business logic
│   ├── pr-processor.js     # PR orchestration
│   └── pr-analyzer.js      # Data analysis
├── ui/                     # UI components
│   ├── activity-element.js # Activity display
│   ├── loader.js           # Loading states
│   ├── tooltip.js          # Interactive tooltips
│   └── version-badge.js    # Version indicator
├── utils/                  # Utilities
│   ├── cache.js            # Cache management
│   ├── token-manager.js    # Token handling
│   ├── api-metrics.js      # API tracking
│   ├── octicons.js         # Icon library
│   ├── dom-helpers.js      # DOM utilities
│   └── i18n.js             # Localization
├── content.js              # Content script entry
├── background.js           # Service worker
└── constants.js            # App constants
```

### Design Principles

- **DRY** (Don't Repeat Yourself): Centralized utilities and shared components
- **KISS** (Keep It Simple, Stupid): Simple, focused modules
- **YAGNI** (You Aren't Gonna Need It): Only essential features
- **SOLID**: Single responsibility, dependency inversion

---

## 🛠️ Development

### Local Development

```bash
# Make changes to source files
# Then reload the extension:
# 1. Go to chrome://extensions/
# 2. Click reload icon on Better GHub card
# 3. Refresh GitHub PR pages to see changes
```

### Project Structure

- `manifest.json` - Extension configuration (Manifest V3)
- `src/` - Source code (ES6 modules)
- `popup/` - Extension popup UI
- `options/` - Options page
- `_locales/` - Internationalization files
- `icons/` - Extension icons

### Tech Stack

- **Manifest V3**: Latest Chrome extension standard
- **ES6 Modules**: Modern JavaScript
- **GitHub APIs**: REST + GraphQL
- **Primer CSS**: GitHub's design system
- **Chrome APIs**: storage.local, i18n, runtime

---

## 🤝 Contributing

We welcome contributions! This project is a great opportunity to experiment with AI-assisted development.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
   - Feel free to use AI tools (ChatGPT, Claude, Copilot, etc.)
   - Document your AI-assisted development process
4. **Test thoroughly**
   - Load the extension in Chrome
   - Test on various GitHub repositories
5. **Commit your changes**
   ```bash
   git commit -m "Add amazing feature"
   ```
6. **Push and create a Pull Request**
   ```bash
   git push origin feature/amazing-feature
   ```

### Development Guidelines

- Follow the existing code structure
- Use ES6 modules
- Maintain compatibility with Manifest V3
- Add translations for new UI strings
- Test in both light and dark mode
- Update README if adding new features

### AI-Assisted Development

We encourage you to:
- Use AI coding assistants for development
- Document interesting AI interactions
- Share prompts that led to breakthrough solutions
- Experiment with different AI tools

---

## 🐛 Known Issues & Limitations

- Requires page refresh after loading GitHub PR list
- GraphQL batching has a 500ms delay for optimization
- OAuth requires manual app registration (PAT recommended)
- Rate limits apply based on authentication method

---

## 📄 License

This project is licensed under the **MIT License** - see below for details:

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

- **GitHub** for their excellent API and Primer design system
- **The AI Community** for making tools that enable projects like this
- **Open Source Contributors** who inspire collaborative development
- **You** for checking out this project!

---

## 📞 Support & Contact

- **Issues**: [GitHub Issues](https://github.com/better-ghub/chrome-extension/issues)
- **Discussions**: [GitHub Discussions](https://github.com/better-ghub/chrome-extension/discussions)
- **Pull Requests**: Always welcome!

---

<div align="center">

**Made with 🤖 AI assistance and ❤️ for the open source community**

If you find this project useful, please consider giving it a ⭐ on GitHub!

</div>
