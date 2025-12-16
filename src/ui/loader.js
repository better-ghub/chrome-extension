// Loading UI Components
// Creates loading spinners and placeholders

const BetterGHub_Loader = {
  createLoadingElement: function() {
    const container = document.createElement('div');
    container.className = `${BetterGHub_Constants.ACTIVITY_CLASS} color-fg-muted text-small mt-1`;
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.alignItems = 'center';

    const spinner = document.createElement('span');
    spinner.className = 'better-ghub-spinner';
    
    const loadingText = document.createElement('span');
    loadingText.className = 'better-ghub-loading-text';
    loadingText.textContent = BetterGHub_i18n.getMessage('loading') || 'Loading activity...';

    container.appendChild(spinner);
    container.appendChild(loadingText);
    
    return container;
  }
};
