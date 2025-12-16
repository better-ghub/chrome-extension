// Version Badge
// Displays version badge in bottom-left corner

const BetterGHub_VersionBadge = {
  showVersionBadge: function() {
    const existing = document.querySelector('.better-ghub-version');
    if (existing) {
      existing.remove();
    }

    const badge = document.createElement('div');
    badge.className = 'better-ghub-version';
    badge.textContent = `Better GHub v${BetterGHub_Constants.VERSION}`;
    
    document.body.appendChild(badge);
    
    console.log(`Better GHub v${BetterGHub_Constants.VERSION}: Initialized`);
  }
};
