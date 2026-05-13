// File operations: File System Access API, import/export, drag-drop on page
window.FileOps = (function() {
  const ES = window.EditorState;
  const supportsFSA = 'showOpenFilePicker' in window;

  function init() {
    const warn = document.getElementById('browser-warning');
    if (!supportsFSA && warn) warn.hidden = false;

    // Drop on page (empty state)
    const drop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.body.classList.remove('drag-over');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.html') || file.name.endsWith('.htm') || file.type === 'text/html')) {
        importFile(file);
      }
    };
    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        document.body.classList.add('drag-over');
      }
    });
    document.addEventListener('dragleave', (e) => {
      if (e.clientX === 0 && e.clientY === 0) document.body.classList.remove('drag-over');
    });
    document.addEventListener('drop', drop);

    // File input fallback
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importFile(f);
      fileInput.value = '';
    });
  }

  async function openLocalFile() {
    if (!supportsFSA) {
      toast('Live local editing requires Chrome/Edge. Use Import instead.', 'warn');
      promptImport();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'HTML files', accept: { 'text/html': ['.html', '.htm'] } }],
        excludeAcceptAllOption: false,
      });
      const file = await handle.getFile();
      const text = await file.text();
      ES.setFile(handle, file.name);
      window.Canvas.loadHtml(text);
      ES.addRecent(file.name);
      toast(`Opened ${file.name} — changes will save to disk`, 'success');
      ES.setDirty(false);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        toast('Could not open file: ' + e.message, 'error');
      }
    }
  }

  function promptImport() {
    document.getElementById('file-input').click();
  }

  async function importFile(file) {
    try {
      const text = await file.text();
      ES.setFile(null, file.name);
      window.Canvas.loadHtml(text);
      ES.addRecent(file.name);
      toast(`Imported ${file.name} (read-only — use Export to save)`, '');
      ES.setDirty(false);
    } catch (e) {
      toast('Could not import: ' + e.message, 'error');
    }
  }

  async function save() {
    const doc = ES.state.doc;
    if (!doc) return;
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    if (ES.state.fileHandle) {
      try {
        const status = document.getElementById('save-status');
        status.dataset.state = 'saving';
        status.textContent = 'Saving…';
        const writable = await ES.state.fileHandle.createWritable();
        await writable.write(stripEditorTraces(html));
        await writable.close();
        ES.setDirty(false);
        status.dataset.state = 'saved';
        status.textContent = 'Saved';
        toast('Saved', 'success');
      } catch (e) {
        const status = document.getElementById('save-status');
        status.dataset.state = 'error';
        status.textContent = 'Error';
        toast('Save failed: ' + e.message, 'error');
      }
    } else {
      // No handle — export instead
      exportFile();
    }
  }

  function exportFile() {
    const doc = ES.state.doc;
    if (!doc) return;
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    const cleaned = stripEditorTraces(html);
    const blob = new Blob([cleaned], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ES.state.fileName || 'untitled.html';
    a.click();
    URL.revokeObjectURL(url);
    ES.setDirty(false);
    toast('Exported ' + a.download, 'success');
  }

  function stripEditorTraces(html) {
    // Remove the injected editor styles and any contenteditable attrs/data flags
    return html
      .replace(/<style id="__he_styles__">[\s\S]*?<\/style>/g, '')
      .replace(/\s+contenteditable="[^"]*"/g, '')
      .replace(/\s+data-he-editing="[^"]*"/g, '');
  }

  function newBlank() {
    const blank = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Untitled</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1f2c; line-height: 1.6; }
h1 { font-size: 32px; }
</style>
</head>
<body>
<h1>New page</h1>
<p>Start editing — click anything to select, double-click to edit text, drag blocks from the sidebar.</p>
</body>
</html>`;
    ES.setFile(null, 'untitled.html');
    window.Canvas.loadHtml(blank);
    ES.setDirty(false);
  }

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  return { init, openLocalFile, promptImport, importFile, save, exportFile, newBlank, supportsFSA };
})();
