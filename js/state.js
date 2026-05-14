// Global editor state and undo/redo
window.EditorState = (function() {
  const state = {
    doc: null,              // The Document inside the iframe
    fileHandle: null,       // FileSystemFileHandle if linked
    fileName: 'untitled.html',
    selected: null,         // Currently selected element in iframe doc
    dirty: false,
    undoStack: [],
    redoStack: [],
    maxHistory: 50,           // hard ceiling on number of snapshots
    maxHistoryBytes: 8 * 1024 * 1024, // ~8MB total, shifts oldest when exceeded
    historyBytes: 0,
    listeners: new Set(),
    snippets: [],
    recent: [],
    theme: 'dark',
    autosaveTimer: null,
    lastAutosave: null,
    // --- Source-text mode foundation ---
    mode: 'visual',         // 'visual' | 'source'
    sourceHtml: '',         // canonical source string (kept in sync; Source mode edits this directly)
  };

  function emit(event, payload) {
    state.listeners.forEach(fn => {
      try { fn(event, payload); } catch (e) { console.error(e); }
    });
  }

  function on(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

  // Snapshot the current canvas document for undo.
  // Dedupes against the most recent snapshot (no-op edits don't grow the
  // stack), and enforces both a count cap and a total-bytes cap so that
  // long sessions on large documents don't balloon memory.
  function snapshot(label = '') {
    if (!state.doc) return;
    const html = state.doc.documentElement.outerHTML;
    const top = state.undoStack[state.undoStack.length - 1];
    if (top && top.html === html) {
      // Edit produced an identical serialization — nothing to push, but
      // make sure dirty / redo state still reflect the user's intent.
      state.redoStack.length = 0;
      setDirty(true);
      return;
    }
    const selPath = state.selected ? pathTo(state.selected) : null;
    const entry = { html, selPath, label, at: Date.now(), bytes: html.length };
    state.undoStack.push(entry);
    state.historyBytes += entry.bytes;

    // Enforce count cap
    while (state.undoStack.length > state.maxHistory) {
      const dropped = state.undoStack.shift();
      state.historyBytes -= dropped.bytes;
    }
    // Enforce bytes cap (but never drop below 2 entries — need one to
    // restore and one as the "current" for the next undo to land on)
    while (state.historyBytes > state.maxHistoryBytes && state.undoStack.length > 2) {
      const dropped = state.undoStack.shift();
      state.historyBytes -= dropped.bytes;
    }
    state.redoStack.length = 0;
    setDirty(true);
    emit('history');
  }

  function pathTo(el) {
    if (!el || !state.doc) return null;
    const path = [];
    let node = el;
    while (node && node !== state.doc.documentElement) {
      const parent = node.parentNode;
      if (!parent) break;
      const idx = Array.prototype.indexOf.call(parent.children, node);
      path.unshift(idx);
      node = parent;
    }
    return path;
  }

  function resolvePath(path) {
    if (!path || !state.doc) return null;
    let node = state.doc.documentElement;
    for (const idx of path) {
      if (!node || !node.children[idx]) return null;
      node = node.children[idx];
    }
    return node;
  }

  function undo() {
    if (state.undoStack.length < 2) return;
    const current = state.undoStack.pop();
    state.redoStack.push(current);
    const prev = state.undoStack[state.undoStack.length - 1];
    restoreSnapshot(prev);
    emit('history');
  }
  function redo() {
    if (state.redoStack.length === 0) return;
    const next = state.redoStack.pop();
    state.undoStack.push(next);
    restoreSnapshot(next);
    emit('history');
  }
  function restoreSnapshot(snap) {
    // Replace the document content
    const oldDoc = state.doc;
    if (!oldDoc) return;
    oldDoc.open();
    oldDoc.write(snap.html);
    oldDoc.close();
    // Reset selection
    state.selected = null;
    setDirty(true);
    emit('doc-replaced');
    // Try to restore selection
    requestAnimationFrame(() => {
      if (snap.selPath) {
        const node = resolvePath(snap.selPath);
        if (node) select(node);
      }
    });
  }

  function setDoc(doc) {
    state.doc = doc;
    state.selected = null;
    state.undoStack = [];
    state.redoStack = [];
    state.historyBytes = 0;
    if (doc) {
      const html = doc.documentElement.outerHTML;
      state.undoStack.push({
        html, selPath: null, label: 'initial', at: Date.now(), bytes: html.length
      });
      state.historyBytes = html.length;
    }
    emit('doc-changed');
  }

  function select(el) {
    if (state.selected === el) return;
    state.selected = el;
    emit('selection-changed', el);
  }
  function deselect() {
    if (state.selected) {
      state.selected = null;
      emit('selection-changed', null);
    }
  }

  function setDirty(d) {
    if (state.dirty === d) return;
    state.dirty = d;
    emit('dirty-changed', d);
  }

  function setFile(handle, name) {
    state.fileHandle = handle;
    state.fileName = name || (handle && handle.name) || 'untitled.html';
    emit('file-changed');
  }

  // Autosave to localStorage (every 2s after change). Pulls from the
  // canonical source in source mode, from the iframe DOM in visual mode.
  function scheduleAutosave() {
    if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => {
      try {
        let html;
        if (state.mode === 'source') {
          html = (window.Source && window.Source.getContent()) || state.sourceHtml || '';
        } else {
          if (!state.doc) return;
          html = state.doc.documentElement.outerHTML;
        }
        if (!html) return;
        localStorage.setItem('html-editor.autosave', html);
        localStorage.setItem('html-editor.autosave.name', state.fileName);
        localStorage.setItem('html-editor.autosave.at', String(Date.now()));
        state.lastAutosave = Date.now();
        emit('autosaved');
      } catch (e) { /* quota exceeded — ignore */ }
    }, 2000);
  }

  function loadAutosave() {
    try {
      const html = localStorage.getItem('html-editor.autosave');
      const name = localStorage.getItem('html-editor.autosave.name') || 'untitled.html';
      const at = parseInt(localStorage.getItem('html-editor.autosave.at') || '0', 10);
      return html ? { html, name, at } : null;
    } catch (e) { return null; }
  }

  // Snippets persisted in localStorage
  function loadSnippets() {
    try { state.snippets = JSON.parse(localStorage.getItem('html-editor.snippets') || '[]'); }
    catch (e) { state.snippets = []; }
    emit('snippets-changed');
  }
  function saveSnippets() {
    localStorage.setItem('html-editor.snippets', JSON.stringify(state.snippets));
    emit('snippets-changed');
  }
  function addSnippet(name, html) {
    state.snippets.unshift({ id: Date.now(), name, html });
    if (state.snippets.length > 50) state.snippets.length = 50;
    saveSnippets();
  }
  function removeSnippet(id) {
    state.snippets = state.snippets.filter(s => s.id !== id);
    saveSnippets();
  }

  // Recent files (just names + dates, handle stored separately if possible)
  function loadRecent() {
    try { state.recent = JSON.parse(localStorage.getItem('html-editor.recent') || '[]'); }
    catch (e) { state.recent = []; }
    emit('recent-changed');
  }
  function addRecent(name) {
    state.recent = [{ name, at: Date.now() }, ...state.recent.filter(r => r.name !== name)].slice(0, 8);
    localStorage.setItem('html-editor.recent', JSON.stringify(state.recent));
    emit('recent-changed');
  }

  // Theme
  function loadTheme() {
    const t = localStorage.getItem('html-editor.theme') || 'dark';
    state.theme = t;
    document.documentElement.setAttribute('data-theme', t);
  }
  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('html-editor.theme', state.theme);
    emit('theme-changed');
  }

  return {
    state, on, emit,
    snapshot, undo, redo,
    setDoc, select, deselect,
    setDirty, setFile,
    scheduleAutosave, loadAutosave,
    pathTo, resolvePath,
    loadSnippets, addSnippet, removeSnippet,
    loadRecent, addRecent,
    loadTheme, toggleTheme,
  };
})();
