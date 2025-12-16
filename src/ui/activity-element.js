// Activity UI Components
// Creates activity display elements for PRs
// Refactored to use centralized Octicons helper

const BetterGHub_ActivityElement = {
  createActivityElement: function(activityData) {
    if (!activityData || !activityData.hasActivity) {
      return null;
    }

    const container = document.createElement('div');
    container.className = `${BetterGHub_Constants.ACTIVITY_CLASS} color-fg-muted text-small mt-1`;
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.alignItems = 'center';
    container.style.flexWrap = 'wrap';

    // Always show last activity info if available
    if (activityData.lastActivityType && activityData.lastActivityAuthor) {
      const activitySpan = document.createElement('span');
      activitySpan.className = 'better-ghub-activity-info';
      activitySpan.style.display = 'flex';
      activitySpan.style.alignItems = 'center';
      activitySpan.style.gap = '4px';

      let icon = '';
      let activityText = '';

      if (activityData.lastActivityType === 'comment') {
        icon = Octicons.get('comment', 16);
        activityText = BetterGHub_i18n.getMessage('lastComment');
      } else if (activityData.lastActivityType === 'commit') {
        icon = Octicons.get('git-commit', 16);
        activityText = BetterGHub_i18n.getMessage('lastCommit');
      }

      activityText += ` ${BetterGHub_i18n.getMessage('by')} ${activityData.lastActivityAuthor}`;

      // Add commit title if available
      if (activityData.lastActivityTitle && activityData.lastActivityType === 'commit') {
        activityText += `: "${activityData.lastActivityTitle}"`;
      }

      activitySpan.innerHTML = icon;
      const textNode = document.createElement('span');
      textNode.textContent = activityText;
      activitySpan.appendChild(textNode);

      container.appendChild(activitySpan);
    }

    // Add unresolved threads count if any
    if (activityData.unresolvedCount > 0) {
      const unresolvedSpan = document.createElement('span');
      unresolvedSpan.className = 'better-ghub-unresolved Label Label--warning';
      unresolvedSpan.style.cursor = 'pointer';
      unresolvedSpan.style.display = 'inline-flex';
      unresolvedSpan.style.alignItems = 'center';
      unresolvedSpan.style.gap = '4px';

      const alertIcon = Octicons.get('alert', 12);
      const text = `${BetterGHub_i18n.getMessage('unresolvedSuggestions')} (${activityData.unresolvedCount})`;

      unresolvedSpan.innerHTML = alertIcon;
      const textNode = document.createElement('span');
      textNode.textContent = text;
      unresolvedSpan.appendChild(textNode);

      let currentTooltip = null;

      // Show tooltip on hover
      unresolvedSpan.addEventListener('mouseenter', () => {
        if (activityData.unresolvedByAuthor && Object.keys(activityData.unresolvedByAuthor).length > 0) {
          currentTooltip = BetterGHub_Tooltip.createUnresolvedTooltip(activityData.unresolvedByAuthor);
          BetterGHub_Tooltip.showTooltip(unresolvedSpan, currentTooltip);
        }
      });

      // Hide tooltip on mouse leave
      unresolvedSpan.addEventListener('mouseleave', () => {
        if (currentTooltip) {
          BetterGHub_Tooltip.hideTooltip(currentTooltip);
          currentTooltip = null;
        }
      });

      container.appendChild(unresolvedSpan);
    }

    return container;
  }
};
