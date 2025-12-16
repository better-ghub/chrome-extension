// DOM Helper Functions
// Utilities for DOM manipulation and element selection

const BetterGHub_DOMHelpers = {
  parsePRUrl: function(url) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
        number: match[3]
      };
    }
    return null;
  },
  
  findPRRows: function() {
    // Find all PR rows - GitHub uses different selectors
    let prRows = document.querySelectorAll('.js-issue-row, [data-id*="issue"]');
    
    if (prRows.length === 0) {
      // Try alternative selector for newer GitHub UI
      prRows = document.querySelectorAll('[id^="issue_"]');
    }
    
    return Array.from(prRows);
  },
  
  isPRListPage: function() {
    return window.location.pathname.match(/\/pulls\/?$/);
  }
};
