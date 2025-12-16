// Tooltip Component
// Creates hover tooltips for unresolved suggestions breakdown

const BetterGHub_Tooltip = {
  createUnresolvedTooltip: function(unresolvedByAuthor) {
    const tooltip = document.createElement('div');
    tooltip.className = 'better-ghub-tooltip';

    const header = document.createElement('div');
    header.className = 'better-ghub-tooltip-header';
    header.textContent = BetterGHub_i18n.getMessage('unresolvedBreakdown') || 'Unresolved by author:';
    tooltip.appendChild(header);

    const list = document.createElement('div');
    list.className = 'better-ghub-tooltip-list';

    const entries = Object.entries(unresolvedByAuthor).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'better-ghub-tooltip-item';
      emptyMsg.textContent = BetterGHub_i18n.getMessage('noUnresolved') || 'No unresolved threads';
      list.appendChild(emptyMsg);
    } else {
      for (const [author, count] of entries) {
        const item = document.createElement('div');
        item.className = 'better-ghub-tooltip-item';

        const authorSpan = document.createElement('span');
        authorSpan.className = 'better-ghub-tooltip-author';
        authorSpan.textContent = author;

        const countSpan = document.createElement('span');
        countSpan.className = 'better-ghub-tooltip-count';
        countSpan.textContent = count;

        item.appendChild(authorSpan);
        item.appendChild(countSpan);
        list.appendChild(item);
      }
    }

    tooltip.appendChild(list);
    return tooltip;
  },

  showTooltip: function(targetElement, tooltipElement) {
    const rect = targetElement.getBoundingClientRect();
    tooltipElement.style.position = 'fixed';
    tooltipElement.style.top = `${rect.bottom + 5}px`;
    tooltipElement.style.left = `${rect.left}px`;
    tooltipElement.style.zIndex = '10000';

    document.body.appendChild(tooltipElement);

    setTimeout(() => {
      tooltipElement.style.opacity = '1';
    }, 10);
  },

  hideTooltip: function(tooltipElement) {
    if (tooltipElement && tooltipElement.parentElement) {
      tooltipElement.style.opacity = '0';
      setTimeout(() => {
        if (tooltipElement.parentElement) {
          tooltipElement.parentElement.removeChild(tooltipElement);
        }
      }, 200);
    }
  }
};
