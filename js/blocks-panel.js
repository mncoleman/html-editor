// Blocks panel — render and wire the draggable component library + snippets/recent
window.BlocksPanel = (function() {
  const ES = window.EditorState;
  let listEl, searchEl, snippetsEl, recentEl, saveSnippetBtn;

  function init() {
    listEl = document.getElementById('blocks-list');
    searchEl = document.getElementById('blocks-search');
    snippetsEl = document.getElementById('snippets-list');
    recentEl = document.getElementById('recent-list');
    saveSnippetBtn = document.getElementById('save-snippet');

    renderBlocks('');
    searchEl.addEventListener('input', () => renderBlocks(searchEl.value));

    ES.on((evt) => {
      if (evt === 'snippets-changed') renderSnippets();
      if (evt === 'recent-changed') renderRecent();
      if (evt === 'selection-changed') {
        saveSnippetBtn.disabled = !ES.state.selected;
      }
    });

    saveSnippetBtn.addEventListener('click', () => {
      const sel = ES.state.selected;
      if (!sel) return;
      const name = prompt('Snippet name:', sel.tagName.toLowerCase());
      if (!name) return;
      ES.addSnippet(name, sel.outerHTML);
      toast('Snippet saved', 'success');
    });

    renderSnippets();
    renderRecent();
  }

  function renderBlocks(filter) {
    listEl.innerHTML = '';
    const f = (filter || '').toLowerCase().trim();
    let lastCat = '';
    for (const b of window.Blocks) {
      const match = !f || b.name.toLowerCase().includes(f) || b.cat.toLowerCase().includes(f);
      if (!match) continue;
      if (b.cat !== lastCat) {
        const h = document.createElement('div');
        h.className = 'block-category';
        h.textContent = b.cat;
        listEl.appendChild(h);
        lastCat = b.cat;
      }
      listEl.appendChild(blockTile(b));
    }
    if (window.renderIcons) window.renderIcons();
  }

  function blockTile(b) {
    const el = document.createElement('div');
    el.className = 'block-item';
    el.draggable = true;
    el.innerHTML = `<div class="block-icon"><i data-lucide="${b.icon}"></i></div><div class="block-name">${b.name}</div>`;
    el.title = b.name;
    el.addEventListener('dragstart', (e) => {
      window.Canvas.setDragData({ type: 'block', html: b.html, name: b.name });
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', b.name);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      window.Canvas.clearDragData();
    });
    // Click to append to selection or body
    el.addEventListener('dblclick', () => {
      const doc = ES.state.doc;
      if (!doc) return;
      const target = ES.state.selected || doc.body;
      const tpl = doc.createElement('template');
      tpl.innerHTML = b.html.trim();
      const node = tpl.content.firstElementChild;
      if (!node) return;
      target.appendChild(node);
      ES.snapshot('insert ' + b.name);
      ES.select(node);
    });
    return el;
  }

  function renderSnippets() {
    snippetsEl.innerHTML = '';
    if (!ES.state.snippets.length) {
      snippetsEl.innerHTML = '<div class="empty-list">No saved snippets yet</div>';
      return;
    }
    for (const s of ES.state.snippets) {
      const item = document.createElement('div');
      item.className = 'snippet-item';
      item.draggable = true;
      const name = document.createElement('span');
      name.textContent = s.name;
      name.style.flex = '1';
      const del = document.createElement('button');
      del.textContent = '×';
      del.title = 'Delete snippet';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete snippet "${s.name}"?`)) ES.removeSnippet(s.id);
      });
      item.appendChild(name);
      item.appendChild(del);
      item.addEventListener('dragstart', (e) => {
        window.Canvas.setDragData({ type: 'snippet', html: s.html, name: s.name });
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', s.name);
      });
      item.addEventListener('dragend', () => window.Canvas.clearDragData());
      item.addEventListener('dblclick', () => {
        const doc = ES.state.doc;
        if (!doc) return;
        const target = ES.state.selected || doc.body;
        const tpl = doc.createElement('template');
        tpl.innerHTML = s.html.trim();
        const node = tpl.content.firstElementChild;
        if (!node) return;
        target.appendChild(node);
        ES.snapshot('insert snippet');
        ES.select(node);
      });
      snippetsEl.appendChild(item);
    }
  }

  function renderRecent() {
    recentEl.innerHTML = '';
    if (!ES.state.recent.length) {
      recentEl.innerHTML = '<div class="empty-list">No recent files</div>';
      return;
    }
    for (const r of ES.state.recent) {
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.title = new Date(r.at).toLocaleString();
      const name = document.createElement('span');
      name.textContent = r.name;
      name.style.flex = '1';
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.whiteSpace = 'nowrap';
      item.appendChild(name);
      recentEl.appendChild(item);
    }
  }

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  return { init };
})();
