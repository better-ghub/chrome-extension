// Cache Management
// Centralized cache for PR data and unresolved threads

class BetterGHub_CacheManager {
  constructor() {
    this.prCache = new Map();
    this.unresolvedThreadsCache = new Map();
  }

  // PR Data Cache
  getPRData(owner, repo, number) {
    const key = `${owner}/${repo}/${number}`;
    const cached = this.prCache.get(key);
    
    if (cached && (Date.now() - cached.timestamp < BetterGHub_Constants.CACHE_DURATION)) {
      return cached.data;
    }
    return null;
  }

  setPRData(owner, repo, number, data) {
    const key = `${owner}/${repo}/${number}`;
    this.prCache.set(key, {
      data: data,
      timestamp: Date.now()
    });
  }

  // Unresolved Threads Cache
  getUnresolvedCount(owner, repo, number) {
    const key = `unresolved_${owner}/${repo}/${number}`;
    const cached = this.unresolvedThreadsCache.get(key);
    
    if (cached && (Date.now() - cached.timestamp < BetterGHub_Constants.CACHE_DURATION)) {
      return cached.count;
    }
    return null;
  }

  setUnresolvedCount(owner, repo, number, count) {
    const key = `unresolved_${owner}/${repo}/${number}`;
    this.unresolvedThreadsCache.set(key, {
      count: count,
      timestamp: Date.now()
    });
  }

  // Clear all caches
  clearAll() {
    this.prCache.clear();
    this.unresolvedThreadsCache.clear();
  }

  // Clear specific PR
  clearPR(owner, repo, number) {
    const prKey = `${owner}/${repo}/${number}`;
    const unresolvedKey = `unresolved_${owner}/${repo}/${number}`;
    this.prCache.delete(prKey);
    this.unresolvedThreadsCache.delete(unresolvedKey);
  }
}
