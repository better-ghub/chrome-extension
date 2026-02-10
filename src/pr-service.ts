// PR Service - Analysis and Processing

import { Constants } from './constants';
import { GitHubRestAPI, GitHubGraphQLAPI } from './api';
import { CacheManager, DOMHelpers } from './utils';
import { Loader, ActivityElement } from './ui';
import type { PRActivityData, PRFullData, PRDisplayData } from './types';

// =============================================================================
// PR Analyzer
// =============================================================================

export class PRAnalyzer {
  static analyze(data: PRFullData | null): PRActivityData | null {
    if (!data?.pr) return null;

    const { pr, commits, unresolvedCount, unresolvedByAuthor } = data;

    let lastActivityType: 'commit' | 'comment' = 'commit';
    let lastActivityAuthor = pr.user.login;
    let lastActivityTitle = pr.title;
    let lastActivityTime = new Date(pr.updated_at);

    if (commits?.length > 0) {
      const lastCommit = commits[commits.length - 1];
      lastActivityType = 'commit';
      lastActivityAuthor = lastCommit.author?.login || lastCommit.committer?.login || pr.user.login;
      lastActivityTitle = lastCommit.commit.message.split('\n')[0];
      lastActivityTime = new Date(lastCommit.commit.committer.date);
    }

    console.log(`Better GHub: Analyzed PR #${pr.number}`, {
      type: lastActivityType,
      author: lastActivityAuthor,
      unresolvedCount: unresolvedCount || 0,
    });

    return {
      hasActivity: true,
      lastActivityType,
      lastActivityAuthor,
      lastActivityTitle,
      lastActivityTime,
      unresolvedCount: unresolvedCount || 0,
      unresolvedByAuthor: unresolvedByAuthor || {},
    };
  }

  static isRecent(activityTime: Date | null, days = 7): boolean {
    if (!activityTime) return false;
    return activityTime.getTime() > Date.now() - days * 24 * 60 * 60 * 1000;
  }

  static formatForDisplay(activityData: PRActivityData | null): PRDisplayData | null {
    if (!activityData) return null;

    let icon = '';
    let text = '';

    if (activityData.lastActivityType === 'comment') {
      icon = 'comment';
      text = `Last comment by ${activityData.lastActivityAuthor}`;
    } else if (activityData.lastActivityType === 'commit') {
      icon = 'git-commit';
      text = `Last commit by ${activityData.lastActivityAuthor}`;
      if (activityData.lastActivityTitle) {
        text += `: "${activityData.lastActivityTitle}"`;
      }
    }

    return {
      icon,
      text,
      isRecent: this.isRecent(activityData.lastActivityTime),
      hasUnresolved: activityData.unresolvedCount > 0,
      unresolvedCount: activityData.unresolvedCount,
      unresolvedByAuthor: activityData.unresolvedByAuthor,
    };
  }
}

// =============================================================================
// PR Processor
// =============================================================================

export class PRProcessor {
  private restAPI: GitHubRestAPI;
  private graphqlAPI: GitHubGraphQLAPI;
  private cache: CacheManager;

  constructor(token: string | null = null) {
    this.restAPI = new GitHubRestAPI(token);
    this.graphqlAPI = new GitHubGraphQLAPI(token);
    this.cache = new CacheManager();
  }

  setToken(token: string | null): void {
    this.restAPI.setToken(token);
    this.graphqlAPI.setToken(token);
  }

  clearCache(): void {
    this.cache.clearAll();
  }

  async processPRRow(row: Element): Promise<void> {
    if (row.getAttribute(Constants.PROCESSED_ATTR)) return;

    const prLink = row.querySelector('a[id^="issue_"][data-hovercard-type="pull_request"]') as HTMLAnchorElement | null;
    if (!prLink) return;

    const prInfo = DOMHelpers.parsePRUrl(prLink.href);
    if (!prInfo) return;

    const prContainer = prLink.closest('.flex-auto, [class*="p-2"]');
    if (!prContainer) return;

    // Only mark as processed after we've confirmed the container exists
    row.setAttribute(Constants.PROCESSED_ATTR, 'true');

    const { owner, repo, number } = prInfo;
    console.log(`Better GHub: Processing PR #${number}`);

    // Remove existing activity elements
    prContainer.querySelectorAll(`.${Constants.ACTIVITY_CLASS}`).forEach((el) => el.remove());

    try {
      const loadingElement = Loader.createLoadingElement();
      prContainer.appendChild(loadingElement);

      // Check cache first
      const cachedData = this.cache.getPRData(owner, repo, number);
      if (cachedData) {
        loadingElement.remove();
        const activityElement = ActivityElement.createActivityElement(cachedData);
        if (activityElement) prContainer.appendChild(activityElement);
        return;
      }

      // Fetch data
      const prData = await this.restAPI.getPRData(owner, repo, number);
      if (!prData) {
        loadingElement.remove();
        return;
      }

      const unresolvedData = await this.graphqlAPI.getUnresolvedThreads(owner, repo, number);

      const fullData: PRFullData = {
        ...prData,
        unresolvedCount: unresolvedData.count,
        unresolvedByAuthor: unresolvedData.byAuthor,
      };

      const activityData = PRAnalyzer.analyze(fullData);
      if (activityData) {
        this.cache.setPRData(owner, repo, number, activityData);
      }

      loadingElement.remove();

      const activityElement = ActivityElement.createActivityElement(activityData);
      if (activityElement) prContainer.appendChild(activityElement);
    } catch (error) {
      console.error(`Better GHub: Error processing PR #${number}:`, error instanceof Error ? error.message : String(error));
      prContainer.querySelectorAll(`.${Constants.ACTIVITY_CLASS}`).forEach((el) => el.remove());
    }
  }
}
