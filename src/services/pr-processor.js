class BetterGHub_PRProcessor {
  constructor(token = null, tokenType = 'pat') {
    this.restAPI = new BetterGHub_GitHubRestAPI(token, tokenType);
    this.graphqlAPI = new BetterGHub_GitHubGraphQLAPI(token, tokenType);
    this.cache = new BetterGHub_CacheManager();
  }

  setToken(token, tokenType = 'pat') {
    this.restAPI.setToken(token, tokenType);
    this.graphqlAPI.setToken(token, tokenType);
  }

  clearCache() {
    this.cache.clearAll();
  }

  analyzePRData(data) {
    return BetterGHub_PRAnalyzer.analyze(data);
  }

  async processPRRow(row) {
    if (row.getAttribute(BetterGHub_Constants.PROCESSED_ATTR)) {
      return;
    }

    const prLink = row.querySelector('a[id^="issue_"][data-hovercard-type="pull_request"]');
    if (!prLink) {
      return;
    }

    const prUrl = prLink.href;
    const prInfo = BetterGHub_DOMHelpers.parsePRUrl(prUrl);
    if (!prInfo) {
      console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Could not parse PR URL: ${prUrl}`);
      return;
    }

    const { owner, repo, number } = prInfo;
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Processing "${prLink.textContent.trim()}" - PR #${number}`);

    row.setAttribute(BetterGHub_Constants.PROCESSED_ATTR, 'true');

    const prContainer = prLink.closest('.flex-auto, [class*="p-2"]');
    if (!prContainer) {
      console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Could not find PR container for PR #${number}`);
      return;
    }

    const existingActivity = prContainer.querySelectorAll(`.${BetterGHub_Constants.ACTIVITY_CLASS}`);
    existingActivity.forEach(el => el.remove());

    try {
      const loadingElement = BetterGHub_Loader.createLoadingElement();
      prContainer.appendChild(loadingElement);

      let cachedData = this.cache.getPRData(owner, repo, number);
      if (cachedData) {
        console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Using cached data for PR #${number}`);
        
        loadingElement.remove();

        const activityElement = BetterGHub_ActivityElement.createActivityElement(cachedData);
        if (!activityElement) return;
        
        prContainer.appendChild(activityElement);
        return;
      }

      const prData = await this.restAPI.getPRData(owner, repo, number);
      if (!prData) {
        loadingElement.remove();
        return;
      }

      const unresolvedData = await this.graphqlAPI.getUnresolvedThreads(owner, repo, number);
      
      const fullData = {
        ...prData,
        unresolvedCount: unresolvedData.count,
        unresolvedByAuthor: unresolvedData.byAuthor
      };

      const activityData = this.analyzePRData(fullData);
      if (activityData) {
        this.cache.setPRData(owner, repo, number, activityData);
      }

      loadingElement.remove();

      const activityElement = BetterGHub_ActivityElement.createActivityElement(activityData);
      if (!activityElement) return;
      
      prContainer.appendChild(activityElement);

    } catch (error) {
      console.error(`Better GHub v${BetterGHub_Constants.VERSION}: Error processing PR #${number}:`, error);
      
      const existingLoader = prContainer.querySelector(`.${BetterGHub_Constants.ACTIVITY_CLASS}`);
      if (existingLoader) {
        existingLoader.remove();
      }
    }
  }
}

