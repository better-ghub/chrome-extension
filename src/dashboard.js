// Better GHub - Dashboard Script
// Adds "Your PR's" section on GitHub main page
// Refactored to use centralized Octicons and TokenManager

let BetterGHub_Dashboard = {
  token: null,
  tokenType: 'pat',
  restAPI: null,
  graphqlAPI: null,
  cache: null,
  
  async init() {
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Dashboard script loaded!`);
    console.log(`Better GHub: Current URL: ${window.location.href}`);
    console.log(`Better GHub: Current pathname: ${window.location.pathname}`);
    
    // Check if we're on the main GitHub page
    if (!this.isDashboardPage()) {
      console.log(`Better GHub: Not a dashboard page, exiting.`);
      return;
    }
    
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Dashboard initializing...`);
    
    // Get GitHub token
    const tokenData = await this.getGitHubToken();
    this.token = tokenData.token;
    this.tokenType = tokenData.tokenType;
    
    if (!this.token) {
      console.log(`Better GHub: No GitHub token. Configure in extension popup.`);
      return;
    }
    
    // Initialize API clients
    this.restAPI = new BetterGHub_GitHubRestAPI(this.token, this.tokenType);
    this.graphqlAPI = new BetterGHub_GitHubGraphQLAPI(this.token, this.tokenType);
    this.cache = new BetterGHub_CacheManager();
    
    // Initialize i18n
    await BetterGHub_i18n.init();
    
    // Create and inject the "Your PR's" section
    await this.createYourPRsSection();
    
    // Watch for navigation changes
    this.setupNavigationWatcher();
  },
  
  isDashboardPage() {
    // Check if we're on the main GitHub dashboard page
    const path = window.location.pathname;
    // Match root path or /dashboard
    const isDashboard = path === '/' || path === '' || path === '/dashboard';
    console.log(`Better GHub: Checking if dashboard page. Path: "${path}", isDashboard: ${isDashboard}`);
    return isDashboard;
  },
  
  async getGitHubToken() {
    // Use TokenManager for centralized token management
    return BetterGHub_TokenManager.getToken();
  },
  
  async fetchUserPRs() {
    if (!this.token) {
      return [];
    }
    
    try {
      // Get current user first
      const authHeader = this.tokenType === 'oauth' ? `Bearer ${this.token}` : `token ${this.token}`;
      
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!userResponse.ok) {
        throw new Error('Failed to fetch user info');
      }
      
      const user = await userResponse.json();
      const username = user.login;
      
      // Fetch open PRs created by the user
      const searchQuery = `is:pr is:open author:${username} sort:updated-desc`;
      const searchUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=10`;
      
      const prsResponse = await fetch(searchUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!prsResponse.ok) {
        throw new Error('Failed to fetch PRs');
      }
      
      const data = await prsResponse.json();
      console.log(`Better GHub: Found ${data.total_count} open PRs for user ${username}`);
      
      return data.items || [];
    } catch (error) {
      console.error(`Better GHub: Error fetching user PRs:`, error);
      return [];
    }
  },
  
  async createYourPRsSection() {
    // Check if section already exists first
    if (document.getElementById('better-ghub-your-prs')) {
      return;
    }
    
    // Find the feed-container element (NOT the mobile repositories section)
    // The feed-container is in the main desktop layout
    let feedContainer = document.querySelector('feed-container');
    
    if (!feedContainer) {
      console.log(`Better GHub: feed-container not found, will retry...`);
      setTimeout(() => this.createYourPRsSection(), 1000);
      return;
    }
    
    console.log(`Better GHub: Found feed-container element`);
    
    // Find the Feed heading inside feed-container
    let feedBox = null;
    const headings = feedContainer.querySelectorAll('h2');
    for (const heading of headings) {
      const text = heading.textContent.trim();
      if (text.includes('Feed') || text.includes('All activity') || text.includes('Following')) {
        // Go up to find the parent container - we want to insert BEFORE feed-container itself
        console.log(`Better GHub: Found Feed heading with text: "${text}"`);
        feedBox = feedContainer;
        break;
      }
    }
    
    if (!feedBox) {
      console.log(`Better GHub: Feed heading not found inside feed-container, will retry...`);
      setTimeout(() => this.createYourPRsSection(), 1000);
      return;
    }
    
    console.log(`Better GHub: Inserting PR section before Feed box...`);
    
    // Create the "Your PR's" section matching GitHub's Feed exactly (no Box wrapper!)
    const section = document.createElement('div');
    section.id = 'better-ghub-your-prs';
    section.className = 'mb-4';
    
    // Add header matching Feed's header exactly: d-flex flex-items-center flex-justify-between
    const header = document.createElement('div');
    header.className = 'd-flex flex-items-center flex-justify-between';
    
    const headerTitle = document.createElement('h2');
    headerTitle.className = 'f5 mb-1';
    headerTitle.innerHTML = `${BetterGHub_i18n.getMessage('yourPRs')}`;
    
    header.appendChild(headerTitle);
    section.appendChild(header);
    
    // Add content area in a Box (like Feed's content)
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
    feedBox.parentNode.insertBefore(section, feedBox);
    console.log(`Better GHub: Inserted "Your PR's" section before feed-container`);
    
    // Fetch and display PRs
    await this.loadPRs();
  },
  
  async loadPRs() {
    const listContainer = document.getElementById('better-ghub-prs-list');
    
    if (!listContainer) {
      return;
    }
    
    try {
      const prs = await this.fetchUserPRs();
      
      listContainer.className = 'Box mt-3';
      
      if (prs.length === 0) {
        listContainer.innerHTML = `
          <div data-view-component="true" class="blankslate border color-bg-default rounded-2">
            <h3 data-view-component="true" class="mb-1">${BetterGHub_i18n.getMessage('noOpenPRs')}</h3>
            <p>You don't have any open pull requests at the moment.</p>
          </div>
        `;
        return;
      }
      
      // Clear and create PR list matching Feed structure (use turbo-frame style)
      listContainer.innerHTML = '';
      
      // Create all PR items first
      for (const pr of prs) {
        try {
          const item = this.createPRItem(pr);
          listContainer.appendChild(item);
          
          // Enhance with activity data asynchronously
          this.enhancePRWithActivity(item, pr).catch(error => {
            console.error(`Better GHub: Error enhancing PR with activity:`, error);
          });
        } catch (error) {
          console.error(`Better GHub: Error creating PR item:`, error);
        }
      }
    } catch (error) {
      console.error(`Better GHub: Error loading PRs:`, error);
      listContainer.innerHTML = `
        <div class="Box-body" style="text-align: center; padding: 32px; color: var(--color-danger-fg);">
          <p class="f5">Error loading PRs. Please check your token.</p>
        </div>
      `;
    }
  },
  
  createPRItem(pr) {
    const wrapper = document.createElement('div');
    wrapper.className = 'better-ghub-item Box-row Box-row--focus-gray';
    
    // Create inner row with flex layout
    const item = document.createElement('div');
    item.className = 'd-flex flex-items-start flex-justify-between';
    
    // Parse repo name from URL (with fallback)
    let repoName = 'unknown/repo';
    try {
      if (pr.repository_url) {
        const urlParts = pr.repository_url.split('/');
        repoName = `${urlParts[urlParts.length - 2]}/${urlParts[urlParts.length - 1]}`;
      }
    } catch (error) {
      console.error(`Better GHub: Error parsing repo URL:`, error);
    }
    
    // Format date
    let timeAgo = '';
    try {
      const updatedDate = new Date(pr.updated_at || pr.created_at);
      const now = new Date();
      const diffMs = now - updatedDate;
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
      console.error(`Better GHub: Error formatting date:`, error);
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
    
    // Create icon column (smaller now)
    const iconCol = document.createElement('div');
    iconCol.className = 'pr-2';
    iconCol.style.flexShrink = '0';
    iconCol.innerHTML = isDraft ? Octicons.get('git-pull-request-draft', 16) : Octicons.get('issue-opened', 16);
    
    // Create content column (takes remaining space)
    const contentCol = document.createElement('div');
    contentCol.className = 'flex-1 ml-2';
    
    // PR Title
    const titleContainer = document.createElement('div');
    const titleLink = document.createElement('a');
    titleLink.href = url;
    titleLink.className = 'Link--primary v-align-middle no-underline h4 mr-1';
    titleLink.textContent = title;
    titleContainer.appendChild(titleLink);
    
    // Meta info (without comments now)
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
    
    // Right section: comments (top-right)
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
  
  async enhancePRWithActivity(itemElement, pr) {
    // Parse PR info from URL
    const prUrl = pr.html_url;
    if (!prUrl) return;
    
    const prInfo = BetterGHub_DOMHelpers.parsePRUrl(prUrl);
    if (!prInfo) return;
    
    const { owner, repo, number } = prInfo;
    
    try {
      // Check cache first
      let cachedData = this.cache.getPRData(owner, repo, number);
      
      if (cachedData) {
        console.log(`Better GHub: Using cached activity data for PR #${number}`);
        const activityElement = BetterGHub_ActivityElement.createActivityElement(cachedData);
        if (activityElement) {
          // Add activity element below the PR row
          activityElement.style.padding = '0 16px 0 32px'; // Indent to match content
          itemElement.appendChild(activityElement);
        }
        return;
      }
      
      // Fetch fresh data
      const prData = await this.restAPI.getPRData(owner, repo, number);
      if (!prData) return;
      
      // Fetch unresolved threads
      const unresolvedData = await this.graphqlAPI.getUnresolvedThreads(owner, repo, number);
      
      const fullData = {
        ...prData,
        unresolvedCount: unresolvedData.count,
        unresolvedByAuthor: unresolvedData.byAuthor
      };
      
      // Analyze data (similar to pr-processor)
      const activityData = this.analyzePRData(fullData);
      if (activityData) {
        this.cache.setPRData(owner, repo, number, activityData);
        
        // Create and add activity element
        const activityElement = BetterGHub_ActivityElement.createActivityElement(activityData);
        if (activityElement) {
          // Add activity element below the PR row
          activityElement.style.padding = '0 16px 0 32px'; // Indent to match content
          itemElement.appendChild(activityElement);
        }
      }
    } catch (error) {
      console.error(`Better GHub: Error enhancing PR #${number} with activity:`, error);
    }
  },
  
  analyzePRData(data) {
    if (!data || !data.pr) return null;
    
    const { pr, commits, unresolvedCount, unresolvedByAuthor } = data;
    
    let lastActivityType = null;
    let lastActivityAuthor = null;
    let lastActivityTitle = null;
    let lastActivityTime = null;
    
    // Use PR updated_at as baseline
    lastActivityTime = new Date(pr.updated_at);
    lastActivityAuthor = pr.user.login;
    
    // Check if there are recent commits
    if (commits && commits.length > 0) {
      const lastCommit = commits[commits.length - 1];
      const commitDate = new Date(lastCommit.commit.committer.date);
      
      lastActivityType = 'commit';
      lastActivityAuthor = lastCommit.author?.login || lastCommit.committer?.login || pr.user.login;
      lastActivityTitle = lastCommit.commit.message.split('\n')[0];
      lastActivityTime = commitDate;
    } else {
      lastActivityType = 'commit';
      lastActivityAuthor = pr.user.login;
      lastActivityTitle = pr.title;
    }
    
    return {
      hasActivity: true,
      lastActivityType,
      lastActivityAuthor,
      lastActivityTitle,
      lastActivityTime,
      unresolvedCount: unresolvedCount || 0,
      unresolvedByAuthor: unresolvedByAuthor || {}
    };
  },
  
  setupNavigationWatcher() {
    let currentURL = window.location.href;
    
    const handleNavigation = () => {
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
            this.createYourPRsSection();
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
    
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      handleNavigation();
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      handleNavigation();
    };
    
    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', handleNavigation);
  }
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'tokenUpdated') {
    console.log(`Better GHub: Token updated, reloading dashboard...`);
    BetterGHub_Dashboard.getGitHubToken().then(tokenData => {
      BetterGHub_Dashboard.token = tokenData.token;
      BetterGHub_Dashboard.tokenType = tokenData.tokenType;
      
      // Reload PRs
      const existingSection = document.getElementById('better-ghub-your-prs');
      if (existingSection) {
        existingSection.remove();
      }
      BetterGHub_Dashboard.createYourPRsSection();
    });
  } else if (request.action === 'tokenRemoved' || request.action === 'tokenInvalid') {
    console.log(`Better GHub: Token ${request.action === 'tokenInvalid' ? 'invalid' : 'removed'}`);
    BetterGHub_Dashboard.token = null;
    
    // Remove section
    const existingSection = document.getElementById('better-ghub-your-prs');
    if (existingSection) {
      existingSection.remove();
    }
  }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => BetterGHub_Dashboard.init());
} else {
  BetterGHub_Dashboard.init();
}

