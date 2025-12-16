const BetterGHub_ApiMetrics = {
  callCount: 0,
  callHistory: [],
  maxHistorySize: 100,

  incrementCall(type = 'rest', endpoint = '') {
    this.callCount++;
    
    // Record in history
    this.callHistory.push({
      type,
      endpoint,
      timestamp: Date.now()
    });
    
    // Trim history if too large
    if (this.callHistory.length > this.maxHistorySize) {
      this.callHistory.shift();
    }
    
    try {
      chrome.runtime.sendMessage({ action: 'incrementApiCalls', type, endpoint }).catch(() => {});
    } catch (error) {}
  },

  getCount() {
    return this.callCount;
  },

  getHistory(minutes = null) {
    if (minutes === null) {
      return [...this.callHistory];
    }
    
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.callHistory.filter(call => call.timestamp >= cutoff);
  },

  getCallsPerMinute(minutes = 5) {
    const recentCalls = this.getHistory(minutes);
    return recentCalls.length / minutes;
  },

  reset() {
    this.callCount = 0;
    this.callHistory = [];
  },

  getStats() {
    const last5min = this.getHistory(5);
    const restCalls = last5min.filter(c => c.type === 'rest').length;
    const graphqlCalls = last5min.filter(c => c.type === 'graphql').length;
    
    return {
      total: this.callCount,
      last5Minutes: last5min.length,
      callsPerMinute: this.getCallsPerMinute(),
      breakdown: {
        rest: restCalls,
        graphql: graphqlCalls
      }
    };
  }
};

