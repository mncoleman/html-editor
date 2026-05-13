// File operations: File System Access API, import/export, drag-drop on page
window.FileOps = (function() {
  const ES = window.EditorState;
  const hasFSA = 'showOpenFilePicker' in window;
  const isSecure = window.isSecureContext;
  const supportsFSA = hasFSA && isSecure;

  function init() {
    const warn = document.getElementById('browser-warning');
    if (warn && !supportsFSA) {
      if (!isSecure && location.protocol === 'http:') {
        warn.innerHTML = `Live local-file editing requires HTTPS. <a href="${location.href.replace(/^http:/, 'https:')}" style="color:inherit;text-decoration:underline;">Switch to HTTPS →</a>`;
      } else if (!hasFSA) {
        warn.textContent = "Your browser doesn't support live local file editing (Safari/Firefox). Import/Export still works.";
      }
      warn.hidden = false;
    }

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
      // No `types` filter: Chrome's first-invocation behavior with
      // accept-maps can grey out matching files until the picker is
      // dismissed and reopened. Simpler to let the user pick any file.
      const [handle] = await window.showOpenFilePicker({ multiple: false });
      const file = await handle.getFile();
      const text = await file.text();
      ES.setFile(handle, file.name);
      ES.state.sourceHtml = text;
      await window.ModeSwitch.loadIntoInitialMode(text);
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
      ES.state.sourceHtml = text;
      await window.ModeSwitch.loadIntoInitialMode(text);
      ES.addRecent(file.name);
      toast(`Imported ${file.name} (read-only — use Export to save)`, '');
      ES.setDirty(false);
    } catch (e) {
      toast('Could not import: ' + e.message, 'error');
    }
  }

  // Get the canonical bytes to write, depending on which mode is active.
  // - Source mode: the CodeMirror buffer, byte-for-byte.
  // - Visual mode: serialize the iframe DOM (known to normalize formatting).
  function currentHtml() {
    if (ES.state.mode === 'source' && window.Source) {
      return window.Source.getContent();
    }
    if (!ES.state.doc) return ES.state.sourceHtml || '';
    return stripEditorTraces('<!DOCTYPE html>\n' + ES.state.doc.documentElement.outerHTML);
  }

  async function save() {
    const html = currentHtml();
    if (!html) return;
    if (ES.state.fileHandle) {
      try {
        const status = document.getElementById('save-status');
        status.dataset.state = 'saving';
        status.textContent = 'Saving…';
        const writable = await ES.state.fileHandle.createWritable();
        await writable.write(html);
        await writable.close();
        ES.state.sourceHtml = html;
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
      exportFile();
    }
  }

  function exportFile() {
    const html = currentHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ES.state.fileName || 'untitled.html';
    a.click();
    URL.revokeObjectURL(url);
    ES.state.sourceHtml = html;
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

  async function newBlank() {
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
    ES.state.sourceHtml = blank;
    await window.ModeSwitch.loadIntoInitialMode(blank);
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
