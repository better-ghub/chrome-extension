// UI Components for Better GHub

import { Constants } from './constants';
import { i18n } from './i18n';
import { Octicons } from './utils';
import type { PRActivityData } from './types';

// =============================================================================
// Tooltip
// =============================================================================

export const Tooltip = {
  createUnresolvedTooltip(unresolvedByAuthor: Record<string, number>): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'better-ghub-tooltip';

    const header = document.createElement('div');
    header.className = 'better-ghub-tooltip-header';
    header.textContent = i18n.getMessage('unresolvedBreakdown') || 'Unresolved by author:';
    tooltip.appendChild(header);

    const list = document.createElement('div');
    list.className = 'better-ghub-tooltip-list';

    const entries = Object.entries(unresolvedByAuthor).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'better-ghub-tooltip-item';
      emptyMsg.textContent = i18n.getMessage('noUnresolved') || 'No unresolved threads';
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
        countSpan.textContent = String(count);

        item.appendChild(authorSpan);
        item.appendChild(countSpan);
        list.appendChild(item);
      }
    }

    tooltip.appendChild(list);
    return tooltip;
  },

  showTooltip(targetElement: HTMLElement, tooltipElement: HTMLDivElement): void {
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

  hideTooltip(tooltipElement: HTMLDivElement | null): void {
    if (tooltipElement?.parentElement) {
      tooltipElement.style.opacity = '0';
      setTimeout(() => {
        tooltipElement.parentElement?.removeChild(tooltipElement);
      }, 200);
    }
  },
};

// =============================================================================
// Loader
// =============================================================================

export const Loader = {
  createLoadingElement(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = `${Constants.ACTIVITY_CLASS} color-fg-muted text-small mt-1`;
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.alignItems = 'center';

    const spinner = document.createElement('span');
    spinner.className = 'better-ghub-spinner';

    const loadingText = document.createElement('span');
    loadingText.className = 'better-ghub-loading-text';
    loadingText.textContent = i18n.getMessage('loading') || 'Loading activity...';

    container.appendChild(spinner);
    container.appendChild(loadingText);

    return container;
  },
};

// =============================================================================
// Activity Element
// =============================================================================

export const ActivityElement = {
  createActivityElement(activityData: PRActivityData | null): HTMLDivElement | null {
    if (!activityData?.hasActivity) return null;

    const container = document.createElement('div');
    container.className = `${Constants.ACTIVITY_CLASS} color-fg-muted text-small mt-1`;
    container.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

    // Last activity info
    if (activityData.lastActivityType && activityData.lastActivityAuthor) {
      const activitySpan = document.createElement('span');
      activitySpan.className = 'better-ghub-activity-info';
      activitySpan.style.cssText = 'display:flex;align-items:center;gap:4px';

      let icon = '';
      let activityText = '';

      if (activityData.lastActivityType === 'comment') {
        icon = Octicons.get('comment', 16);
        activityText = i18n.getMessage('lastComment');
      } else if (activityData.lastActivityType === 'commit') {
        icon = Octicons.get('git-commit', 16);
        activityText = i18n.getMessage('lastCommit');
      }

      activityText += ` ${i18n.getMessage('by')} ${activityData.lastActivityAuthor}`;

      if (activityData.lastActivityTitle && activityData.lastActivityType === 'commit') {
        activityText += `: "${activityData.lastActivityTitle}"`;
      }

      activitySpan.innerHTML = icon;
      const textNode = document.createElement('span');
      textNode.textContent = activityText;
      activitySpan.appendChild(textNode);
      container.appendChild(activitySpan);
    }

    // Unresolved threads count
    if (activityData.unresolvedCount > 0) {
      const unresolvedSpan = document.createElement('span');
      unresolvedSpan.className = 'better-ghub-unresolved Label Label--warning';
      unresolvedSpan.style.cssText = 'cursor:pointer;display:inline-flex;align-items:center;gap:4px';

      const alertIcon = Octicons.get('alert', 12);
      const text = `${i18n.getMessage('unresolvedSuggestions')} (${activityData.unresolvedCount})`;

      unresolvedSpan.innerHTML = alertIcon;
      const textNode = document.createElement('span');
      textNode.textContent = text;
      unresolvedSpan.appendChild(textNode);

      let currentTooltip: HTMLDivElement | null = null;

      unresolvedSpan.addEventListener('mouseenter', () => {
        if (activityData.unresolvedByAuthor && Object.keys(activityData.unresolvedByAuthor).length > 0) {
          currentTooltip = Tooltip.createUnresolvedTooltip(activityData.unresolvedByAuthor);
          Tooltip.showTooltip(unresolvedSpan, currentTooltip);
        }
      });

      unresolvedSpan.addEventListener('mouseleave', () => {
        if (currentTooltip) {
          Tooltip.hideTooltip(currentTooltip);
          currentTooltip = null;
        }
      });

      container.appendChild(unresolvedSpan);
    }

    return container;
  },
};

// =============================================================================
// Version Badge
// =============================================================================

export const VersionBadge = {
  showVersionBadge(): void {
    const existing = document.querySelector('.better-ghub-version');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.className = 'better-ghub-version';
    badge.textContent = `Better GHub v${Constants.VERSION}`;

    document.body.appendChild(badge);
    console.log(`Better GHub v${Constants.VERSION}: Initialized`);
  },
};
