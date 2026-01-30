// Better GHub - Dashboard Script
// Adds "Your PR's" section on GitHub main page

import { Constants } from './constants';
import { GitHubRestAPI, GitHubGraphQLAPI } from './api';
import { CacheManager, DOMHelpers, TokenManager, Octicons } from './utils';
import { i18n } from './i18n';
import { ActivityElement } from './ui';
import type { PRActivityData, PRFullData } from './types';

interface SearchPR {
  html_url: string;
  repository_url?: string;
  title?: string;
  number?: number;
  comments?: number;
  draft?: boolean;
  updated_at?: string;
  created_at?: string;
}

const Dashboard = {
  token: null as string | null,
  restAPI: null as GitHubRestAPI | null,
  graphqlAPI: null as GitHubGraphQLAPI | null,
  cache: null as CacheManager | null,

  async init(): Promise<void> {
    console.log(`Better GHub v${Constants.VERSION}: Dashboard script loaded!`);

    if (!this.isDashboardPage()) {
      console.log('Better GHub: Not a dashboard page, exiting.');
      return;
    }

    console.log(`Better GHub v${Constants.VERSION}: Dashboard initializing...`);

    const tokenData = await TokenManager.getToken();
    this.token = tokenData.token || null;

    if (!this.token) {
      console.log('Better GHub: No GitHub token. Configure in extension popup.');
      return;
    }

    this.restAPI = new GitHubRestAPI(this.token);
    this.graphqlAPI = new GitHubGraphQLAPI(this.token);
    this.cache = new CacheManager();

    // Initialize i18n
    await i18n.init();

    // Create and inject the "Your PR's" section
    await this.createYourPRsSection();

    // Watch for navigation changes
    this.setupNavigationWatcher();
  },

  isDashboardPage(): boolean {
    // Check if we're on the main GitHub dashboard page
    const path = window.location.pathname;
    // Match root path or /dashboard
    const isDashboard = path === '/' || path === '' || path === '/dashboard';
    console.log(`Better GHub: Checking if dashboard page. Path: "${path}", isDashboard: ${isDashboard}`);
    return isDashboard;
  },

  async fetchUserPRs(): Promise<SearchPR[]> {
    if (!this.restAPI) {
      return [];
    }

    try {
      // Get current user
      const user = await this.restAPI.getCurrentUser();
      if (!user) {
        throw new Error('Failed to fetch user info');
      }

      // Search for open PRs created by the user
      const searchQuery = `is:pr is:open author:${user.login} sort:updated-desc`;
      const data = await this.restAPI.searchIssues(searchQuery, 10);

      console.log(`Better GHub: Found ${data.total_count} open PRs for user ${user.login}`);
      return data.items || [];
    } catch (error) {
      console.error('Better GHub: Error fetching user PRs:', error);
      return [];
    }
  },

  async createYourPRsSection(): Promise<void> {
    // Check if section already exists first
    if (document.getElementById('better-ghub-your-prs')) {
      return;
    }

    // Find the feed-container element (NOT the mobile repositories section)
    let feedContainer = document.querySelector('feed-container');

    if (!feedContainer) {
      console.log('Better GHub: feed-container not found, will retry...');
      setTimeout(() => void this.createYourPRsSection(), 1000);
      return;
    }

    console.log('Better GHub: Found feed-container element');

    // Find the Feed heading inside feed-container
    let feedBox: Element | null = null;
    const headings = feedContainer.querySelectorAll('h2');
    for (const heading of headings) {
      const text = heading.textContent?.trim() || '';
      if (text.includes('Feed') || text.includes('All activity') || text.includes('Following')) {
        console.log(`Better GHub: Found Feed heading with text: "${text}"`);
        feedBox = feedContainer;
        break;
      }
    }

    if (!feedBox) {
      console.log('Better GHub: Feed heading not found inside feed-container, will retry...');
      setTimeout(() => void this.createYourPRsSection(), 1000);
      return;
    }

    console.log('Better GHub: Inserting PR section before Feed box...');

    // Create the "Your PR's" section
    const section = document.createElement('div');
    section.id = 'better-ghub-your-prs';
    section.className = 'mb-4';

    // Add header
    const header = document.createElement('div');
    header.className = 'd-flex flex-items-center flex-justify-between';

    const headerTitle = document.createElement('h2');
    headerTitle.className = 'f5 mb-1';
    headerTitle.textContent = i18n.getMessage('yourPRs');

    header.appendChild(headerTitle);
    section.appendChild(header);

    // Add content area in a Box
    const content = document.createElement('div');
    content.id = 'better-ghub-prs-list';
    content.className = 'Box mt-3';
    content.innerHTML = `
      <div class="Box-body" style="padding: 16px; text-align: center;">
        <span data-view-component="true">
          <svg style="box-sizing: content-box; color: var(--color-icon-primary);" width="32" height="32" viewBox="0 0 16 16" fill="none" aria-hidden="true" data-view-component="true" class="anim-rotate">
            <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" vector-effect="non-scaling-stroke" fill="none"></circle>
            <path d="M15 8a7.002 7.002 0 00-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
          </svg>
          <span class="sr-only">Loading</span>
        </span>
      </div>
    `;
    section.appendChild(content);

    // Insert BEFORE the feed-container element
    feedBox.parentNode?.insertBefore(section, feedBox);
    console.log("Better GHub: Inserted \"Your PR's\" section before feed-container");

    // Fetch and display PRs
    await this.loadPRs();
  },

  async loadPRs(): Promise<void> {
    const listContainer = document.getElementById('better-ghub-prs-list');

    if (!listContainer) {
      return;
    }

    try {
      const prs = await this.fetchUserPRs();

      listContainer.className = 'Box mt-3';

      if (prs.length === 0) {
        listContainer.innerHTML = '';
        const blankslate = document.createElement('div');
        blankslate.className = 'blankslate border color-bg-default rounded-2';
        blankslate.setAttribute('data-view-component', 'true');
        
        const heading = document.createElement('h3');
        heading.className = 'mb-1';
        heading.setAttribute('data-view-component', 'true');
        heading.textContent = i18n.getMessage('noOpenPRs');
        
        const description = document.createElement('p');
        description.textContent = i18n.getMessage('noOpenPRsDescription');
        
        blankslate.appendChild(heading);
        blankslate.appendChild(description);
        listContainer.appendChild(blankslate);
        return;
      }

      // Clear and create PR list
      listContainer.innerHTML = '';

      // Create all PR items first
      for (const pr of prs) {
        try {
          const item = this.createPRItem(pr);
          listContainer.appendChild(item);

          // Enhance with activity data asynchronously
          this.enhancePRWithActivity(item, pr).catch((error) => {
            console.error('Better GHub: Error enhancing PR with activity:', error);
          });
        } catch (error) {
          console.error('Better GHub: Error creating PR item:', error);
        }
      }
    } catch (error) {
      console.error('Better GHub: Error loading PRs:', error);
      listContainer.innerHTML = `
        <div class="Box-body" style="text-align: center; padding: 32px; color: var(--color-danger-fg);">
          <p class="f5">Error loading PRs. Please check your token.</p>
        </div>
      `;
    }
  },

  createPRItem(pr: SearchPR): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'better-ghub-item Box-row Box-row--focus-gray';

    // Create inner row with flex layout
    const item = document.createElement('div');
    item.className = 'd-flex flex-items-start flex-justify-between';

    // Parse repo name from URL
    let repoName = 'unknown/repo';
    try {
      if (pr.repository_url) {
        const urlParts = pr.repository_url.split('/');
        repoName = `${urlParts[urlParts.length - 2]}/${urlParts[urlParts.length - 1]}`;
      }
    } catch (error) {
      console.error('Better GHub: Error parsing repo URL:', error);
    }

    // Format date
    let timeAgo = '';
    try {
      const updatedDate = new Date(pr.updated_at || pr.created_at || '');
      const now = new Date();
      const diffMs = now.getTime() - updatedDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        timeAgo = 'just now';
      } else if (diffMins < 60) {
        timeAgo = `${diffMins}m ago`;
      } else if (diffHours < 24) {
        timeAgo = `${diffHours}h ago`;
      } else if (diffDays < 30) {
        timeAgo = `${diffDays}d ago`;
      } else {
        timeAgo = updatedDate.toLocaleDateString();
      }
    } catch (error) {
      console.error('Better GHub: Error formatting date:', error);
      timeAgo = '';
    }

    // Get PR state
    const isDraft = pr.draft || false;

    // Safely get title and URL
    const title = pr.title || 'Untitled PR';
    const url = pr.html_url || '#';
    const number = pr.number || '?';
    const comments = pr.comments || 0;

    // Left section: icon + content
    const leftSection = document.createElement('div');
    leftSection.className = 'd-flex flex-1 flex-items-start';

    // Create icon column
    const iconCol = document.createElement('div');
    iconCol.className = 'pr-2';
    iconCol.style.flexShrink = '0';
    iconCol.innerHTML = isDraft ? Octicons.get('git-pull-request-draft', 16) : Octicons.get('issue-opened', 16);

    // Create content column
    const contentCol = document.createElement('div');
    contentCol.className = 'flex-1 ml-2';

    // PR Title
    const titleContainer = document.createElement('div');
    const titleLink = document.createElement('a');
    titleLink.href = url;
    titleLink.className = 'Link--primary v-align-middle no-underline h4 mr-1';
    titleLink.textContent = title;
    titleContainer.appendChild(titleLink);

    // Meta info
    const metaContainer = document.createElement('div');
    metaContainer.className = 'f6 color-fg-muted mt-1';

    const repoLink = document.createElement('span');
    repoLink.className = 'color-fg-muted';
    repoLink.textContent = repoName;

    metaContainer.appendChild(repoLink);
    metaContainer.appendChild(document.createTextNode(` #${number}`));

    if (timeAgo) {
      metaContainer.appendChild(document.createTextNode(' • '));
      const timeSpan = document.createElement('span');
      timeSpan.textContent = timeAgo;
      metaContainer.appendChild(timeSpan);
    }

    contentCol.appendChild(titleContainer);
    contentCol.appendChild(metaContainer);

    leftSection.appendChild(iconCol);
    leftSection.appendChild(contentCol);

    // Right section: comments
    const rightSection = document.createElement('div');
    rightSection.className = 'ml-3 text-right';
    rightSection.style.flexShrink = '0';

    if (comments > 0) {
      const commentsSpan = document.createElement('div');
      commentsSpan.className = 'd-inline-flex flex-items-center f6 color-fg-muted';
      commentsSpan.innerHTML = `${Octicons.get('comment', 16)} <span class="ml-1">${comments}</span>`;
      rightSection.appendChild(commentsSpan);
    }

    item.appendChild(leftSection);
    item.appendChild(rightSection);

    // Add the row to wrapper
    wrapper.appendChild(item);

    return wrapper;
  },

  async enhancePRWithActivity(itemElement: HTMLElement, pr: SearchPR): Promise<void> {
    // Parse PR info from URL
    const prUrl = pr.html_url;
    if (!prUrl) return;

    const prInfo = DOMHelpers.parsePRUrl(prUrl);
    if (!prInfo) return;

    const { owner, repo, number } = prInfo;

    try {
      // Check cache first
      const cachedData = this.cache?.getPRData(owner, repo, number);

      if (cachedData) {
        console.log(`Better GHub: Using cached activity data for PR #${number}`);
        const activityElement = ActivityElement.createActivityElement(cachedData);
        if (activityElement) {
          activityElement.style.padding = '0 16px 0 32px';
          itemElement.appendChild(activityElement);
        }
        return;
      }

      // Fetch fresh data
      const prData = await this.restAPI?.getPRData(owner, repo, number);
      if (!prData) return;

      // Fetch unresolved threads
      const unresolvedData = await this.graphqlAPI?.getUnresolvedThreads(owner, repo, number);

      const fullData: PRFullData = {
        ...prData,
        unresolvedCount: unresolvedData?.count || 0,
        unresolvedByAuthor: unresolvedData?.byAuthor || {},
      };

      // Analyze data
      const activityData = this.analyzePRData(fullData);
      if (activityData) {
        this.cache?.setPRData(owner, repo, number, activityData);

        // Create and add activity element
        const activityElement = ActivityElement.createActivityElement(activityData);
        if (activityElement) {
          activityElement.style.padding = '0 16px 0 32px';
          itemElement.appendChild(activityElement);
        }
      }
    } catch (error) {
      console.error(`Better GHub: Error enhancing PR #${number} with activity:`, error);
    }
  },

  analyzePRData(data: PRFullData): PRActivityData | null {
    if (!data || !data.pr) return null;

    const { pr, commits, unresolvedCount, unresolvedByAuthor } = data;

    let lastActivityType: 'commit' | 'comment' = 'commit';
    let lastActivityAuthor: string = pr.user.login;
    let lastActivityTitle: string = pr.title;
    let lastActivityTime: Date = new Date(pr.updated_at);

    // Check if there are recent commits
    if (commits && commits.length > 0) {
      const lastCommit = commits[commits.length - 1];
      const commitDate = new Date(lastCommit.commit.committer.date);

      lastActivityType = 'commit';
      lastActivityAuthor = lastCommit.author?.login || lastCommit.committer?.login || pr.user.login;
      lastActivityTitle = lastCommit.commit.message.split('\n')[0];
      lastActivityTime = commitDate;
    }

    return {
      hasActivity: true,
      lastActivityType,
      lastActivityAuthor,
      lastActivityTitle,
      lastActivityTime,
      unresolvedCount: unresolvedCount || 0,
      unresolvedByAuthor: unresolvedByAuthor || {},
    };
  },

  setupNavigationWatcher(): void {
    let currentURL = window.location.href;

    const handleNavigation = (): void => {
      const newURL = window.location.href;
      if (newURL !== currentURL) {
        console.log(`Better GHub Dashboard: Navigation detected from ${currentURL} to ${newURL}`);
        currentURL = newURL;

        // Small delay to let GitHub's SPA update the DOM
        setTimeout(() => {
          if (this.isDashboardPage()) {
            // Remove old section to avoid duplicates
            const existingSection = document.getElementById('better-ghub-your-prs');
            if (existingSection) {
              existingSection.remove();
            }
            void this.createYourPRsSection();
          }
        }, 100);
      }
    };

    // Watch for turbo/pjax navigation
    document.addEventListener('turbo:load', handleNavigation);
    document.addEventListener('turbo:render', handleNavigation);
    document.addEventListener('turbo:frame-load', handleNavigation);
    document.addEventListener('pjax:end', handleNavigation);

    // Watch for URL changes using history API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      originalPushState.apply(this, args);
      handleNavigation();
    };

    history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
      originalReplaceState.apply(this, args);
      handleNavigation();
    };

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', handleNavigation);
  },
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request: { action: string }) => {
  if (request.action === 'tokenUpdated') {
    console.log('Better GHub: Token updated, reloading dashboard...');
    TokenManager.getToken()
      .then((tokenData) => {
        Dashboard.token = tokenData.token || null;
        
        if (Dashboard.restAPI) Dashboard.restAPI.setToken(Dashboard.token);
        if (Dashboard.graphqlAPI) Dashboard.graphqlAPI.setToken(Dashboard.token);

        const existingSection = document.getElementById('better-ghub-your-prs');
        if (existingSection) existingSection.remove();
        void Dashboard.createYourPRsSection();
      })
      .catch((error: Error) => {
        console.error('Better GHub: Error updating token:', error);
      });
  } else if (request.action === 'tokenRemoved' || request.action === 'tokenInvalid') {
    console.log(`Better GHub: Token ${request.action === 'tokenInvalid' ? 'invalid' : 'removed'}`);
    Dashboard.token = null;
    
    if (Dashboard.restAPI) Dashboard.restAPI.setToken(null);
    if (Dashboard.graphqlAPI) Dashboard.graphqlAPI.setToken(null);

    const existingSection = document.getElementById('better-ghub-your-prs');
    if (existingSection) existingSection.remove();
  }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void Dashboard.init());
} else {
  void Dashboard.init();
}

export { Dashboard };
