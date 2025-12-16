class BetterGHub_PRAnalyzer {
  static analyze(data) {
    if (!data || !data.pr) {
      return null;
    }

    const { pr, commits, unresolvedCount, unresolvedByAuthor } = data;
    
    let lastActivityType = null;
    let lastActivityAuthor = null;
    let lastActivityTitle = null;
    let lastActivityTime = null;

    lastActivityTime = new Date(pr.updated_at);
    lastActivityAuthor = pr.user.login;
    
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

    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Analyzed PR #${pr.number}`, {
      type: lastActivityType,
      author: lastActivityAuthor,
      title: lastActivityTitle,
      time: lastActivityTime,
      unresolvedCount: unresolvedCount || 0
    });

    return {
      hasActivity: true,
      lastActivityType,
      lastActivityAuthor,
      lastActivityTitle,
      lastActivityTime,
      unresolvedCount: unresolvedCount || 0,
      unresolvedByAuthor: unresolvedByAuthor || {}
    };
  }

  static isRecent(activityTime, days = 7) {
    if (!activityTime) return false;
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return activityTime.getTime() > cutoff;
  }

  static formatForDisplay(activityData) {
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
      unresolvedByAuthor: activityData.unresolvedByAuthor
    };
  }
}

