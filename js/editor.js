// Bootstrap: wire toolbar buttons, sidebar tabs, status updates, theme
(function() {
  const ES = window.EditorState;
  let isPreview = false;

  // Render Lucide icons (initial + idempotent for dynamic content)
  window.renderIcons = function() {
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  };

  document.addEventListener('DOMContentLoaded', () => {
    ES.loadTheme();
    ES.loadSnippets();
    ES.loadRecent();
    document.body.dataset.mode = ES.state.mode || 'visual';

    // Wait one tick so the deferred lucide UMD has executed
    requestAnimationFrame(() => window.renderIcons());

    window.Canvas.init();
    window.Tree.init();
    window.Properties.init();
    window.BlocksPanel.init();
    window.FileOps.init();
    window.Keyboard.init();

    wireEmptyState();
    wireToolbar();
    wireTabs();
    wireStatusUpdates();
    wireModeToggle();

    // Restore autosave if any
    const auto = ES.loadAutosave();
    if (auto && auto.html) {
      const minutes = Math.round((Date.now() - auto.at) / 60000);
      const age = minutes < 60 ? `${minutes}m` : `${Math.round(minutes/60)}h`;
      const restore = document.createElement('button');
      restore.className = 'btn';
      restore.style.marginTop = '12px';
      restore.innerHTML = `<i data-lucide="history" class="icon"></i><span>Restore last session</span><small>${age} ago · ${escapeHtml(auto.name)}</small>`;
      restore.addEventListener('click', async () => {
        ES.setFile(null, auto.name);
        ES.state.sourceHtml = auto.html;
        showEditor();
        await window.ModeSwitch.loadIntoInitialMode(auto.html);
      });
      const empty = document.querySelector('.empty-inner');
      const hint = document.querySelector('.empty-drop-hint');
      hint.parentNode.insertBefore(restore, hint);
      window.renderIcons();
    }
  });

  function wireEmptyState() {
    document.getElementById('empty-open-local').addEventListener('click', async () => {
      await window.FileOps.openLocalFile();
      if (ES.state.doc) showEditor();
    });
    document.getElementById('empty-import').addEventListener('click', () => {
      window.FileOps.promptImport();
    });
    document.getElementById('empty-new').addEventListener('click', () => {
      window.FileOps.newBlank();
      showEditor();
    });
    // After any file load — visual (doc-changed) or source (mode-changed) — flip to editor
    ES.on((evt) => {
      if (evt === 'doc-changed' && ES.state.doc) showEditor();
      if (evt === 'mode-changed') showEditor();
    });
  }

  function showEditor() {
    document.getElementById('empty-state').hidden = true;
    document.getElementById('editor').hidden = false;
    requestAnimationFrame(() => window.Canvas.updateOverlay());
  }

  function wireToolbar() {
    document.getElementById('tb-undo').addEventListener('click', () => ES.undo());
    document.getElementById('tb-redo').addEventListener('click', () => ES.redo());
    document.getElementById('tb-duplicate').addEventListener('click', () => window.Canvas.duplicateSelected());
    document.getElementById('tb-delete').addEventListener('click', () => window.Canvas.deleteSelected());
    document.getElementById('tb-move-up').addEventListener('click', () => window.Canvas.moveSelected(-1));
    document.getElementById('tb-move-down').addEventListener('click', () => window.Canvas.moveSelected(1));
    document.getElementById('tb-parent').addEventListener('click', () => {
      const s = ES.state.selected;
      if (s && s.parentElement && s.parentElement !== ES.state.doc.documentElement) ES.select(s.parentElement);
    });

    document.querySelectorAll('.device-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.device-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        window.Canvas.setDevice(b.dataset.device);
      });
    });

    const setPreview = (on) => {
      isPreview = on;
      document.getElementById('editor').classList.toggle('preview-mode', isPreview);
      document.getElementById('tb-preview').classList.toggle('active', isPreview);
      document.getElementById('exit-preview-btn').hidden = !isPreview;
      window.Canvas.setPreview(isPreview);
    };
    document.getElementById('tb-preview').addEventListener('click', () => setPreview(!isPreview));
    document.getElementById('exit-preview-btn').addEventListener('click', () => setPreview(false));
    window.__heExitPreview = () => { if (isPreview) { setPreview(false); return true; } return false; };

    document.getElementById('tb-external-preview').addEventListener('click', () => {
      const doc = ES.state.doc;
      if (!doc) return;
      const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
        .replace(/<style id="__he_styles__">[\s\S]*?<\/style>/g, '')
        .replace(/\s+contenteditable="[^"]*"/g, '')
        .replace(/\s+data-he-editing="[^"]*"/g, '');
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

    document.getElementById('tb-open').addEventListener('click', async () => {
      await window.FileOps.openLocalFile();
    });
    document.getElementById('tb-refresh').addEventListener('click', () => window.FileOps.reloadFromDisk());
    document.getElementById('tb-import').addEventListener('click', () => window.FileOps.promptImport());
    document.getElementById('tb-export').addEventListener('click', () => window.FileOps.exportFile());
    document.getElementById('tb-save').addEventListener('click', () => window.FileOps.save());

    document.getElementById('tb-theme').addEventListener('click', () => ES.toggleTheme());
  }

  function wireTabs() {
    document.querySelectorAll('.sidebar-tabs').forEach(group => {
      group.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        const sidebar = group.closest('.sidebar');
        sidebar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        sidebar.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        sidebar.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      });
    });
  }

  function wireModeToggle() {
    const toggle = document.getElementById('mode-toggle');
    toggle.addEventListener('click', async (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      const target = btn.dataset.mode;
      if (target === ES.state.mode) return;
      await window.ModeSwitch.setMode(target);
    });

    ES.on((evt, payload) => {
      if (evt === 'mode-changed') {
        const mode = payload || ES.state.mode;
        document.querySelectorAll('.mode-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === mode);
        });
        const canvasWrap = document.getElementById('canvas-wrap');
        const sourceWrap = document.getElementById('source-wrap');
        const leftSidebar = document.querySelector('.left-sidebar');
        const rightSidebar = document.querySelector('.right-sidebar');
        if (mode === 'source') {
          canvasWrap.hidden = true;
          sourceWrap.hidden = false;
          // Hide DOM-centric panels in source mode
          leftSidebar.hidden = true;
          rightSidebar.hidden = true;
        } else {
          canvasWrap.hidden = false;
          sourceWrap.hidden = true;
          leftSidebar.hidden = false;
          rightSidebar.hidden = false;
        }
      }
    });
  }

  function wireStatusUpdates() {
    const fileName = document.getElementById('file-name');
    const saveStatus = document.getElementById('save-status');
    const autosaveTime = document.getElementById('autosave-time');

    ES.on((evt, payload) => {
      if (evt === 'file-changed') {
        fileName.textContent = ES.state.fileName + (ES.state.fileHandle ? ' (linked)' : ' (read-only)');
        fileName.title = ES.state.fileHandle ? 'Live-linked to local file' : 'Imported — use Export or Save (download)';
      }
      if (evt === 'dirty-changed') {
        if (ES.state.dirty) {
          saveStatus.dataset.state = 'dirty';
          saveStatus.textContent = '● Unsaved';
          document.body.dataset.dirty = 'true';
        } else {
          saveStatus.dataset.state = 'saved';
          saveStatus.textContent = 'Saved';
          document.body.dataset.dirty = 'false';
        }
      }
      if (evt === 'history') {
        document.getElementById('tb-undo').disabled = ES.state.undoStack.length < 2;
        document.getElementById('tb-redo').disabled = ES.state.redoStack.length === 0;
      }
      if (evt === 'autosaved') {
        autosaveTime.textContent = new Date(ES.state.lastAutosave).toLocaleTimeString();
      }
    });

    // Block accidental close when dirty
    window.addEventListener('beforeunload', (e) => {
      if (ES.state.dirty && !ES.state.fileHandle) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }
})();
