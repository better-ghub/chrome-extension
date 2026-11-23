// Better GHub - Comment templates: insert text into a textarea at the caret.

/**
 * Inserts `text` replacing the selection. `execCommand('insertText')` goes
 * through the browser's editing pipeline, so GitHub's React state, autosize
 * and the native undo stack all see a normal user edit. When it is refused
 * (or unsupported) we fall back to setRangeText + a bubbling `input` event.
 */
export function insertText(textarea: HTMLTextAreaElement, text: string, caret?: { start: number; end: number }): void {
  textarea.focus({ preventScroll: true });
  if (caret) textarea.setSelectionRange(caret.start, caret.end);
  let done = false;
  try {
    done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  } catch {
    done = false;
  }
  if (done) return;
  const start = textarea.selectionStart;
  textarea.setRangeText(text, start, textarea.selectionEnd, 'end');
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}
