// Diff viewer — compares the editor's current content against what's
// currently on disk. Renders a unified diff in a modal. Library: jsdiff
// (ESM CDN, lazy-loaded on first open).
window.DiffViewer = (function() {
  const ES = window.EditorState;
  let jsdiff = null;

  async function ensureLib() {
    if (jsdiff) return jsdiff;
    jsdiff = await import('https://esm.sh/diff@5.2.0');
    return jsdiff;
  }

  function currentEditorText() {
    if (ES.state.mode === 'source' && window.Source) {
      return window.Source.getContent();
    }
    if (!ES.state.doc) return ES.state.sourceHtml || '';
    return ('<!DOCTYPE html>\n' + ES.state.doc.documentElement.outerHTML)
      .replace(/<style id="__he_styles__">[\s\S]*?<\/style>/g, '')
      .replace(/\s+contenteditable="[^"]*"/g, '')
      .replace(/\s+data-he-editing="[^"]*"/g, '');
  }

  async function showAgainstDisk() {
    if (!ES.state.fileHandle) {
      toast('No linked file — open one with "Open Local File" first', 'warn');
      return;
    }
    let diskText;
    try {
      const file = await ES.state.fileHandle.getFile();
      diskText = await file.text();
    } catch (e) {
      toast('Could not read file: ' + e.message, 'error');
      return;
    }
    const editorText = currentEditorText();
    if (diskText === editorText) {
      toast('No differences — editor matches disk', 'success');
      return;
    }
    await renderModal(diskText, editorText, 'on disk', 'editor');
  }

  async function renderModal(oldText, newText, oldLabel, newLabel, opts) {
    opts = opts || {};
    const lib = await ensureLib();
    const changes = lib.diffLines(oldText, newText);

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // Stats
    let adds = 0, dels = 0;
    changes.forEach(c => {
      if (c.added) adds += c.count || (c.value.split('\n').length - 1);
      if (c.removed) dels += c.count || (c.value.split('\n').length - 1);
    });

    const modal = document.createElement('div');
    modal.className = 'diff-modal';
    modal.innerHTML = `
      <div class="diff-panel" role="dialog" aria-label="Diff viewer">
        <header class="diff-header">
          <div class="diff-title">
            <span class="diff-label diff-label-old">${escapeHtml(oldLabel)}</span>
            <i data-lucide="arrow-right" class="diff-arrow"></i>
            <span class="diff-label diff-label-new">${escapeHtml(newLabel)}</span>
            <span class="diff-stats">
              <span class="diff-stat-add">+${adds}</span>
              <span class="diff-stat-del">-${dels}</span>
            </span>
          </div>
          <div class="diff-actions">
            <button class="diff-mode-btn active" data-view="unified" title="Unified view"><i data-lucide="rows-3"></i></button>
            <button class="diff-mode-btn" data-view="split" title="Side-by-side view"><i data-lucide="columns-2"></i></button>
            <span class="diff-spacer"></span>
            <button class="diff-action-btn" id="diff-copy" title="Copy diff to clipboard"><i data-lucide="copy"></i></button>
            ${opts.hideApplyButtons ? '' : `
            <button class="diff-action-btn" id="diff-apply-disk" title="Discard editor changes — load disk version"><i data-lucide="download"></i><span>Use disk</span></button>
            <button class="diff-action-btn diff-action-primary" id="diff-save" title="Save editor → disk"><i data-lucide="save"></i><span>Save to disk</span></button>`}
            <button class="diff-close" aria-label="Close"><i data-lucide="x"></i></button>
          </div>
        </header>
        <div class="diff-body" data-view="unified"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const body = modal.querySelector('.diff-body');
    renderUnified(body, changes);

    // View toggle
    modal.querySelectorAll('.diff-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.diff-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        body.dataset.view = view;
        body.innerHTML = '';
        if (view === 'unified') renderUnified(body, changes);
        else renderSplit(body, oldLines, newLines, changes);
      });
    });

    // Copy diff text
    modal.querySelector('#diff-copy').addEventListener('click', () => {
      const patch = lib.createTwoFilesPatch(oldLabel, newLabel, oldText, newText);
      navigator.clipboard.writeText(patch).then(
        () => toast('Diff copied to clipboard', 'success'),
        () => toast('Copy failed', 'error')
      );
    });

    // Apply / save buttons exist only when not hidden
    const applyBtn = modal.querySelector('#diff-apply-disk');
    if (applyBtn) applyBtn.addEventListener('click', async () => {
      if (!confirm('Discard your editor changes and load the disk version?')) return;
      await window.FileOps.reloadFromDisk({ force: true });
      close();
    });
    const saveBtn = modal.querySelector('#diff-save');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      await window.FileOps.save();
      close();
    });

    function close() { modal.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    modal.querySelector('.diff-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    if (window.renderIcons) window.renderIcons();
  }

  function renderUnified(host, changes) {
    let oldNo = 0, newNo = 0;
    changes.forEach(c => {
      const lines = c.value.split('\n');
      // Last token is often empty when value ended with \n — drop it
      if (lines[lines.length - 1] === '') lines.pop();
      lines.forEach((line) => {
        const cls = c.added ? 'added' : c.removed ? 'removed' : 'context';
        const sigil = c.added ? '+' : c.removed ? '-' : ' ';
        if (c.removed) oldNo++;
        else if (c.added) newNo++;
        else { oldNo++; newNo++; }
        const lineEl = document.createElement('div');
        lineEl.className = 'diff-line ' + cls;
        lineEl.innerHTML = `
          <span class="diff-num diff-num-old">${c.added ? '' : oldNo}</span>
          <span class="diff-num diff-num-new">${c.removed ? '' : newNo}</span>
          <span class="diff-sigil">${sigil}</span>
          <span class="diff-content"></span>
        `;
        lineEl.querySelector('.diff-content').textContent = line;
        host.appendChild(lineEl);
      });
    });
  }

  // Side-by-side: align unchanged spans, stagger add/remove
  function renderSplit(host, oldLines, newLines, changes) {
    host.classList.add('split');
    const wrap = document.createElement('div');
    wrap.className = 'diff-split';

    const colOld = document.createElement('div');
    colOld.className = 'diff-col diff-col-old';
    const colNew = document.createElement('div');
    colNew.className = 'diff-col diff-col-new';

    let oldNo = 0, newNo = 0;
    changes.forEach(c => {
      const lines = c.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      if (!c.added && !c.removed) {
        lines.forEach(line => {
          oldNo++; newNo++;
          colOld.appendChild(mkLine('context', oldNo, line));
          colNew.appendChild(mkLine('context', newNo, line));
        });
      } else if (c.removed) {
        lines.forEach(line => {
          oldNo++;
          colOld.appendChild(mkLine('removed', oldNo, line));
          colNew.appendChild(mkLine('empty', '', ''));
        });
      } else if (c.added) {
        lines.forEach(line => {
          newNo++;
          colOld.appendChild(mkLine('empty', '', ''));
          colNew.appendChild(mkLine('added', newNo, line));
        });
      }
    });

    wrap.appendChild(colOld);
    wrap.appendChild(colNew);
    host.appendChild(wrap);
  }

  function mkLine(cls, num, content) {
    const el = document.createElement('div');
    el.className = 'diff-line ' + cls;
    el.innerHTML = `<span class="diff-num">${num}</span><span class="diff-content"></span>`;
    el.querySelector('.diff-content').textContent = content;
    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  return { showAgainstDisk, _renderModal: renderModal };
})();
