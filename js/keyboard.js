// Global keyboard shortcuts
window.Keyboard = (function() {
  const ES = window.EditorState;

  function init() {
    document.addEventListener('keydown', handle, true);
  }

  function handle(e) {
    const mod = e.metaKey || e.ctrlKey;
    const inField = isInField(e.target);

    // Save: cmd+S even if in field
    if (mod && e.key === 's') {
      e.preventDefault();
      window.FileOps.save();
      return;
    }
    // Undo/redo
    if (mod && e.key === 'z' && !e.shiftKey) {
      if (inField) return;
      e.preventDefault();
      ES.undo();
      return;
    }
    if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey)) ) {
      if (inField) return;
      e.preventDefault();
      ES.redo();
      return;
    }
    if (mod && e.key === 'y') {
      if (inField) return;
      e.preventDefault();
      ES.redo();
      return;
    }

    if (inField) return;

    // Duplicate
    if (mod && e.key === 'd') {
      e.preventDefault();
      window.Canvas.duplicateSelected();
      return;
    }
    // Delete
    if ((e.key === 'Delete' || e.key === 'Backspace') && ES.state.selected) {
      e.preventDefault();
      window.Canvas.deleteSelected();
      return;
    }
    // Escape: exit preview if active, otherwise deselect
    if (e.key === 'Escape') {
      if (window.__heExitPreview && window.__heExitPreview()) return;
      ES.deselect();
      return;
    }
    // Arrow up/down: move selected
    if (e.key === 'ArrowUp' && mod) {
      e.preventDefault();
      window.Canvas.moveSelected(-1);
      return;
    }
    if (e.key === 'ArrowDown' && mod) {
      e.preventDefault();
      window.Canvas.moveSelected(1);
      return;
    }
    // Preview toggle
    if (e.key === 'p' || e.key === 'P') {
      if (!mod) {
        document.getElementById('tb-preview').click();
      }
    }
  }

  function isInField(t) {
    if (!t) return false;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  return { init };
})();
