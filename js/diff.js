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

  // How many lines of context to show on each side of a change when
  // unchanged regions are collapsed.
  const CONTEXT_LINES = 3;

  async function renderModal(oldText, newText, oldLabel, newLabel, opts) {
    opts = opts || {};
    const lib = await ensureLib();
    const changes = lib.diffLines(oldText, newText);
    let collapsed = true; // default: hide unchanged regions

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
            <button class="diff-mode-btn diff-collapse-toggle active" id="diff-collapse-toggle" title="Show only changed regions (with ${CONTEXT_LINES} lines of context)"><i data-lucide="unfold-vertical"></i><span>Collapse</span></button>
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

    let currentView = 'unified';
    function rerender() {
      body.innerHTML = '';
      const segments = collapsed ? segmentChanges(changes, CONTEXT_LINES) : null;
      if (currentView === 'unified') renderUnified(body, changes, segments);
      else renderSplit(body, oldLines, newLines, changes, segments);
    }
    rerender();

    // View toggle (unified / split)
    modal.querySelectorAll('.diff-mode-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.diff-mode-btn[data-view]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        body.dataset.view = currentView;
        rerender();
      });
    });

    // Collapse / expand-all toggle
    const collapseBtn = modal.querySelector('#diff-collapse-toggle');
    collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      collapseBtn.classList.toggle('active', collapsed);
      collapseBtn.title = collapsed ? 'Click to show every line' : `Click to hide unchanged regions (${CONTEXT_LINES} lines of context)`;
      collapseBtn.querySelector('span').textContent = collapsed ? 'Collapse' : 'Expand all';
      rerender();
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
      const ok = await window.Dialog.confirm({
        title: 'Discard editor changes?',
        message: 'The on-disk version will replace what you have in the editor.',
        confirmLabel: 'Discard & load disk',
        danger: true,
      });
      if (!ok) return;
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

  // Flatten changes into a per-line list. Returns:
  //   [{ kind: 'added'|'removed'|'context', line, oldNo, newNo }, ...]
  function flatten(changes) {
    const out = [];
    let oldNo = 0, newNo = 0;
    changes.forEach(c => {
      const lines = c.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      const kind = c.added ? 'added' : c.removed ? 'removed' : 'context';
      lines.forEach(line => {
        if (c.removed) oldNo++;
        else if (c.added) newNo++;
        else { oldNo++; newNo++; }
        out.push({
          kind,
          line,
          oldNo: c.added ? null : oldNo,
          newNo: c.removed ? null : newNo,
        });
      });
    });
    return out;
  }

  // Split the flattened lines into visible runs and collapsed gaps.
  // Visible = a change OR within CONTEXT_LINES of a change.
  // Gap = a run of pure-context lines with no change nearby.
  function segmentChanges(changes, contextLines) {
    const lines = flatten(changes);
    const keep = new Array(lines.length).fill(false);
    lines.forEach((l, i) => {
      if (l.kind !== 'context') {
        const lo = Math.max(0, i - contextLines);
        const hi = Math.min(lines.length - 1, i + contextLines);
        for (let j = lo; j <= hi; j++) keep[j] = true;
      }
    });
    const segments = [];
    let i = 0;
    while (i < lines.length) {
      const v = keep[i];
      const start = i;
      while (i < lines.length && keep[i] === v) i++;
      segments.push({ type: v ? 'visible' : 'gap', lines: lines.slice(start, i) });
    }
    return segments;
  }

  // Render a single flat line into the unified body.
  function mkUnifiedLine(l) {
    const sigil = l.kind === 'added' ? '+' : l.kind === 'removed' ? '-' : ' ';
    const lineEl = document.createElement('div');
    lineEl.className = 'diff-line ' + l.kind;
    lineEl.innerHTML = `
      <span class="diff-num diff-num-old">${l.oldNo == null ? '' : l.oldNo}</span>
      <span class="diff-num diff-num-new">${l.newNo == null ? '' : l.newNo}</span>
      <span class="diff-sigil">${sigil}</span>
      <span class="diff-content"></span>
    `;
    lineEl.querySelector('.diff-content').textContent = l.line;
    return lineEl;
  }

  // Build a clickable "N hidden lines — show" placeholder. When clicked,
  // replaces itself with the actual lines (or with another gap row that
  // expands the rest if the user only wants a piece).
  function mkGapRow(hiddenLines, renderer) {
    const row = document.createElement('div');
    row.className = 'diff-gap';
    const count = hiddenLines.length;
    row.innerHTML = `
      <button class="diff-gap-btn" title="Show all ${count} hidden line${count === 1 ? '' : 's'}">
        <i data-lucide="chevrons-up-down"></i>
        <span>${count} unchanged line${count === 1 ? '' : 's'} hidden</span>
      </button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      const frag = document.createDocumentFragment();
      hiddenLines.forEach(l => frag.appendChild(renderer(l)));
      row.replaceWith(frag);
    });
    return row;
  }

  function renderUnified(host, changes, segments) {
    if (!segments) {
      flatten(changes).forEach(l => host.appendChild(mkUnifiedLine(l)));
    } else {
      segments.forEach(seg => {
        if (seg.type === 'visible') {
          seg.lines.forEach(l => host.appendChild(mkUnifiedLine(l)));
        } else {
          host.appendChild(mkGapRow(seg.lines, mkUnifiedLine));
        }
      });
    }
    if (window.renderIcons) window.renderIcons();
  }

  // Side-by-side: grid with two columns; gap rows span both via
  // grid-column: 1 / -1.
  function renderSplit(host, oldLines, newLines, changes, segments) {
    host.classList.add('split');
    const wrap = document.createElement('div');
    wrap.className = 'diff-split';

    const segs = segments || [{ type: 'visible', lines: flatten(changes) }];
    segs.forEach(seg => {
      if (seg.type === 'gap') {
        const gap = document.createElement('div');
        gap.className = 'diff-gap diff-gap-full';
        const count = seg.lines.length;
        gap.innerHTML = `
          <button class="diff-gap-btn" title="Show all ${count} hidden line${count === 1 ? '' : 's'}">
            <i data-lucide="chevrons-up-down"></i>
            <span>${count} unchanged line${count === 1 ? '' : 's'} hidden</span>
          </button>
        `;
        gap.querySelector('button').addEventListener('click', () => {
          const frag = document.createDocumentFragment();
          seg.lines.forEach(l => appendSplitPair(frag, l));
          gap.replaceWith(frag);
        });
        wrap.appendChild(gap);
      } else {
        seg.lines.forEach(l => appendSplitPair(wrap, l));
      }
    });

    host.appendChild(wrap);
    if (window.renderIcons) window.renderIcons();
  }

  function appendSplitPair(parent, l) {
    const left = mkSplitCell(
      l.kind === 'added' ? 'empty' : l.kind,
      l.kind === 'added' ? '' : l.oldNo,
      l.kind === 'added' ? '' : l.line
    );
    const right = mkSplitCell(
      l.kind === 'removed' ? 'empty' : l.kind,
      l.kind === 'removed' ? '' : l.newNo,
      l.kind === 'removed' ? '' : l.line
    );
    parent.appendChild(left);
    parent.appendChild(right);
  }

  function mkSplitCell(cls, num, content) {
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
