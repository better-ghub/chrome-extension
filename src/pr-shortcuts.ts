// Better GHub - PR Page Keyboard Shortcuts

import { Constants } from './constants';
import { i18n } from './i18n';

/**
 * Detects current PR page view type
 */
function getCurrentView(): 'conversation' | 'files' | 'commits' | 'checks' | 'unknown' {
  const url = window.location.href;
  const path = window.location.pathname;
  
  console.log('Better GHub: Detecting view - URL:', url, 'Path:', path);
  
  // URL-based detection is most reliable - check specific sub-paths first
  // GitHub uses both /files and /changes for the files changed view
  if (path.match(/\/pull\/\d+\/(files|changes)/)) {
    console.log('Better GHub: Detected FILES view from URL path');
    return 'files';
  }
  if (path.match(/\/pull\/\d+\/commits/)) {
    console.log('Better GHub: Detected COMMITS view from URL');
    return 'commits';
  }
  if (path.match(/\/pull\/\d+\/checks/)) {
    console.log('Better GHub: Detected CHECKS view from URL');
    return 'checks';
  }
  
  // Conversation is the default PR page (just /pull/123 without sub-path)
  // This MUST come before DOM fallback to avoid false positives
  if (/\/pull\/\d+\/?$/.test(path)) {
    console.log('Better GHub: Detected CONVERSATION view from URL');
    return 'conversation';
  }
  
  // If URL has a hash fragment that indicates files view
  if (url.includes('#diff-') || url.includes('#discussion_')) {
    console.log('Better GHub: Detected FILES view from URL hash');
    return 'files';
  }
  
  return 'unknown';
}

/**
 * Check if a details element is inside a markdown comment body
 * These should NOT be toggled (e.g., CodeRabbit summaries)
 */
function isInsideCommentBody(element: HTMLElement): boolean {
  const parent = element.closest('.markdown-body, .comment-body, .js-comment-body');
  return parent !== null;
}

/**
 * Toggle all review comments in conversation view
 * Only uses <details> elements to avoid clicking wrong buttons
 */
function toggleAllComments(): void {
  console.log('Better GHub: Starting toggle comments in conversation view...');

  // Find all <details> elements that are comment containers
  // Exclude those inside markdown bodies (like CodeRabbit summaries)
  const allDetails = document.querySelectorAll<HTMLDetailsElement>(
    // Outdated/resolved conversation containers
    'details.js-resolvable-timeline-thread-container, ' +
    'details.outdated-diff-comment-container, ' +
    // Review thread containers
    'details.review-thread-component, ' +
    // Generic timeline item details (but we'll filter these)
    '.js-timeline-item > details, ' +
    '.TimelineItem > details'
  );
  
  const toggleableDetails: HTMLDetailsElement[] = [];
  
  allDetails.forEach(details => {
    // Skip if inside markdown body (CodeRabbit summaries, etc.)
    if (isInsideCommentBody(details)) {
      const summaryText = details.querySelector('summary')?.textContent?.slice(0, 30) || '';
      console.log(`Better GHub: Skipping details inside comment body: "${summaryText}"`);
      return;
    }
    
    // Only include details that have a summary (proper collapsible)
    const summary = details.querySelector(':scope > summary');
    if (!summary) {
      return;
    }
    
    toggleableDetails.push(details);
  });

  console.log(`Better GHub: Found ${allDetails.length} details elements, ${toggleableDetails.length} are toggleable`);

  if (toggleableDetails.length === 0) {
    console.log('Better GHub: No toggleable comments found in conversation view');
    return;
  }

  // Count open vs closed
  const openCount = toggleableDetails.filter(d => d.open).length;
  const shouldOpen = openCount <= toggleableDetails.length / 2;

  console.log(`Better GHub: Open: ${openCount}/${toggleableDetails.length}, will ${shouldOpen ? 'OPEN' : 'CLOSE'} all`);

  // Toggle all details elements
  toggleableDetails.forEach(details => {
    if (shouldOpen && !details.open) {
      details.open = true;
    } else if (!shouldOpen && details.open) {
      details.open = false;
    }
  });

  console.log('Better GHub: Comments toggled successfully');
}

/**
 * Toggle all code review comments in files changed view
 * This toggles inline comments on the diff, not the files themselves
 */
function toggleAllCommentsinFilesView(): void {
  console.log('Better GHub: Starting toggle comments in files view...');

  // Strategy 1: Find the collapse/expand buttons for inline comments (GitHub's new React UI)
  // These buttons have data-is-first-collapse-button="true" attribute
  const collapseButtons = document.querySelectorAll<HTMLElement>(
    'button[data-is-first-collapse-button="true"]'
  );
  
  console.log('Better GHub: Collapse buttons found:', collapseButtons.length);

  // Strategy 2: Find review thread containers
  const reviewThreads = document.querySelectorAll<HTMLElement>(
    '[data-testid="review-thread"], ' +
    '[data-marker-id], ' +
    '.ReviewThread-module__ReviewThreadContainer__IxmRvoT'
  );
  
  console.log('Better GHub: Review threads found:', reviewThreads.length);

  // Strategy 3: Find inline markers (comment indicators on diff lines)
  const inlineMarkers = document.querySelectorAll<HTMLElement>(
    '[data-inline-markers="true"], ' +
    '.InlineMarkers-module__markersWrapper__hvvnQ9e'
  );
  
  console.log('Better GHub: Inline markers found:', inlineMarkers.length);

  // Strategy 4: Find "Return to code" buttons (to close expanded comments)
  const returnToCodeButtons = document.querySelectorAll<HTMLElement>(
    'button[data-exit-dialog-mode-button="true"]'
  );
  
  console.log('Better GHub: Return to code buttons found:', returnToCodeButtons.length);

  // Strategy 5: Find comment marker buttons (small indicators that expand to full comments)
  const markerButtons = document.querySelectorAll<HTMLElement>(
    '[data-first-marker="true"], ' +
    '.InlineMarkers-module__markerButton__'
  );
  
  console.log('Better GHub: Marker buttons found:', markerButtons.length);

  let didToggle = false;

  // If we have collapse buttons, click them to collapse/expand comments
  if (collapseButtons.length > 0) {
    console.log(`Better GHub: Clicking ${collapseButtons.length} collapse buttons`);
    collapseButtons.forEach((btn, idx) => {
      const tooltipId = btn.getAttribute('aria-labelledby');
      let tooltipText = '';
      if (tooltipId) {
        const tooltip = document.getElementById(tooltipId);
        tooltipText = tooltip?.textContent || '';
      }
      console.log(`Better GHub: Collapse button ${idx}: tooltip="${tooltipText}"`);
      btn.click();
      didToggle = true;
    });
  }

  // If no collapse buttons found, try "Return to code" buttons to close comments
  if (!didToggle && returnToCodeButtons.length > 0) {
    console.log(`Better GHub: Clicking ${returnToCodeButtons.length} return to code buttons`);
    returnToCodeButtons.forEach(btn => {
      btn.click();
      didToggle = true;
    });
  }

  // If still nothing, try clicking on marker containers to toggle them
  if (!didToggle && markerButtons.length > 0) {
    console.log(`Better GHub: Clicking ${markerButtons.length} marker buttons`);
    markerButtons.forEach(marker => {
      const btn = marker.querySelector<HTMLElement>('button');
      if (btn) {
        btn.click();
        didToggle = true;
      }
    });
  }

  if (!didToggle) {
    console.log('Better GHub: No toggleable comments found in files view');
  } else {
    console.log('Better GHub: Comments toggled successfully');
  }
}

/**
 * Toggle all file diffs (collapse/expand files) in Files changed view
 * This toggles the file diffs themselves, not the comments
 */
function toggleAllFileDiffs(): void {
  console.log('Better GHub: Starting toggle file diffs in files view...');

  // Find all file collapse/expand buttons in the diff headers
  // These are IconButtons in the DiffFileHeader that have chevron icons
  // and tooltips like "Collapse file" or "Expand file"
  const diffHeaders = document.querySelectorAll<HTMLElement>(
    '[class*="DiffFileHeader-module__diff-file-header"]'
  );
  
  console.log('Better GHub: Diff headers found:', diffHeaders.length);

  const fileToggleButtons: HTMLElement[] = [];
  let expandedCount = 0;
  let collapsedCount = 0;

  diffHeaders.forEach((header) => {
    // Find the first button container (with width: 28px) - this contains the collapse button
    const buttonContainer = header.querySelector<HTMLElement>(
      '.d-flex.flex-shrink-0.flex-order-1'
    );
    
    if (!buttonContainer) return;
    
    const button = buttonContainer.querySelector<HTMLElement>(
      'button[data-component="IconButton"]'
    );
    
    if (!button) return;
    
    // Check the tooltip to determine if it's expanded or collapsed
    const tooltipId = button.getAttribute('aria-labelledby');
    let counted = false;
    
    if (tooltipId) {
      const tooltip = document.getElementById(tooltipId);
      const tooltipText = tooltip?.textContent?.toLowerCase() || '';
      
      // "Collapse file" means it's currently expanded
      // "Expand file" means it's currently collapsed
      if (tooltipText.includes('collapse')) {
        expandedCount++;
        counted = true;
      } else if (tooltipText.includes('expand')) {
        collapsedCount++;
        counted = true;
      }
    }
    
    // Also check for chevron direction as backup (only if tooltip didn't give us info)
    if (!counted) {
      const chevron = button.querySelector('svg');
      if (chevron) {
        const chevronClass = chevron.getAttribute('class') || '';
        if (chevronClass.includes('chevron-down')) {
          // Down chevron typically means expanded (can collapse)
          expandedCount++;
        } else if (chevronClass.includes('chevron-right')) {
          // Right chevron typically means collapsed (can expand)
          collapsedCount++;
        }
      }
    }
    
    fileToggleButtons.push(button);
  });

  console.log(`Better GHub: Found ${fileToggleButtons.length} file toggle buttons (${expandedCount} expanded, ${collapsedCount} collapsed)`);

  if (fileToggleButtons.length === 0) {
    console.log('Better GHub: No file toggle buttons found');
    return;
  }

  // Determine action: if most are expanded, collapse all; otherwise expand all
  const shouldCollapse = expandedCount > collapsedCount;
  console.log(`Better GHub: Will ${shouldCollapse ? 'COLLAPSE' : 'EXPAND'} all files`);

  // Click all the buttons
  fileToggleButtons.forEach((btn, idx) => {
    console.log(`Better GHub: Clicking file toggle button ${idx + 1}/${fileToggleButtons.length}`);
    btn.click();
  });

  console.log('Better GHub: File diffs toggled successfully');
}

/**
 * Main toggle handler for comments - detects view and calls appropriate function
 */
function handleToggleAll(): void {
  const view = getCurrentView();
  
  console.log(`Better GHub: Toggle all comments triggered in ${view} view`);

  switch (view) {
    case 'conversation':
      toggleAllComments();
      break;
    case 'files':
      toggleAllCommentsinFilesView();
      break;
    default:
      console.log('Better GHub: Toggle not supported in this view');
  }
}

/**
 * Handler for toggling file diffs (collapse/expand files)
 */
function handleToggleFiles(): void {
  const view = getCurrentView();
  
  console.log(`Better GHub: Toggle files triggered in ${view} view`);

  if (view === 'files') {
    toggleAllFileDiffs();
  } else {
    console.log('Better GHub: Toggle files only works in Files changed view');
  }
}

// Listen for keyboard shortcut command from background
chrome.runtime.onMessage.addListener((request: { action: string }) => {
  console.log('Better GHub: Message received:', request);
  if (request.action === 'toggle-all') {
    console.log('Better GHub: Toggle comments command received from background');
    handleToggleAll();
  } else if (request.action === 'toggle-files') {
    console.log('Better GHub: Toggle files command received from background');
    handleToggleFiles();
  }
});

// Also support direct keyboard listener as fallback
document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Alt+C (Option+C on Mac) - toggle comments
  if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    console.log('Better GHub: Keyboard shortcut detected (Alt+C / Option+C)');
    handleToggleAll();
  }
  // Alt+F (Option+F on Mac) - toggle files
  if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    console.log('Better GHub: Keyboard shortcut detected (Alt+F / Option+F)');
    handleToggleFiles();
  }
});

/**
 * Check if we're on a PR page
 */
function isPRPage(): boolean {
  return /\/pull\/\d+/.test(window.location.pathname);
}

/**
 * Detect if user is on macOS for displaying correct key symbols
 */
function isMac(): boolean {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}

/**
 * Create and show keyboard shortcuts help panel
 */
function showShortcutsHelp(): void {
  console.log('Better GHub: showShortcutsHelp called, pathname:', window.location.pathname);
  
  // Remove existing panel if any
  const existing = document.querySelector('.better-ghub-shortcuts');
  if (existing) existing.remove();

  // Only show on PR pages
  if (!isPRPage()) {
    console.log('Better GHub: Not a PR page, skipping shortcuts panel');
    return;
  }
  
  console.log('Better GHub: Creating shortcuts panel');

  const panel = document.createElement('div');
  panel.className = 'better-ghub-shortcuts';

  const header = document.createElement('div');
  header.className = 'better-ghub-shortcuts-header';
  header.textContent = i18n.getMessage('keyboardShortcuts') || 'Keyboard Shortcuts';
  panel.appendChild(header);

  const list = document.createElement('div');
  list.className = 'better-ghub-shortcuts-list';

  const altKey = isMac() ? '⌥' : 'Alt';

  // Shortcut: Alt+C - Toggle comments
  const item1 = document.createElement('div');
  item1.className = 'better-ghub-shortcut-item';
  
  const key1 = document.createElement('span');
  key1.className = 'better-ghub-shortcut-key';
  key1.textContent = `${altKey}+C`;
  
  const desc1 = document.createElement('span');
  desc1.className = 'better-ghub-shortcut-desc';
  desc1.textContent = i18n.getMessage('shortcutToggleComments') || 'Toggle comments';
  
  item1.appendChild(key1);
  item1.appendChild(desc1);
  list.appendChild(item1);

  // Shortcut: Alt+F - Toggle file diffs
  const item2 = document.createElement('div');
  item2.className = 'better-ghub-shortcut-item';
  
  const key2 = document.createElement('span');
  key2.className = 'better-ghub-shortcut-key';
  key2.textContent = `${altKey}+F`;
  
  const desc2 = document.createElement('span');
  desc2.className = 'better-ghub-shortcut-desc';
  desc2.textContent = i18n.getMessage('shortcutToggleFiles') || 'Toggle file diffs';
  
  item2.appendChild(key2);
  item2.appendChild(desc2);
  list.appendChild(item2);

  // Note: Files view only
  const note = document.createElement('div');
  note.className = 'better-ghub-shortcut-note';
  note.textContent = `(${altKey}+F: ${i18n.getMessage('shortcutFilesViewOnly') || 'Files view only'})`;
  list.appendChild(note);

  panel.appendChild(list);
  document.body.appendChild(panel);
  console.log('Better GHub: Shortcuts panel added to DOM');
}

// Initialize shortcuts help panel
async function initShortcutsHelp(): Promise<void> {
  try {
    await i18n.init();
  } catch (e) {
    console.log('Better GHub: i18n init failed, using defaults', e);
  }
  console.log('Better GHub: Showing shortcuts help panel');
  showShortcutsHelp();
}

// Show shortcuts help on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initShortcutsHelp());
} else {
  void initShortcutsHelp();
}

// Re-show shortcuts help on navigation (SPA support)
['turbo:load', 'turbo:render', 'pjax:end'].forEach((event) => {
  document.addEventListener(event, () => {
    setTimeout(() => showShortcutsHelp(), 100);
  });
});

// Also watch for URL changes via history API
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(() => showShortcutsHelp(), 100);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

console.log(`Better GHub v${Constants.VERSION}: PR shortcuts loaded`);

export { handleToggleAll, handleToggleFiles, toggleAllComments, toggleAllCommentsinFilesView, toggleAllFileDiffs, showShortcutsHelp };
