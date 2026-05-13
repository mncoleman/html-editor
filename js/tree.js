// DOM tree panel + breadcrumbs
window.Tree = (function() {
  const ES = window.EditorState;
  let treeEl, breadcrumbsEl;
  const collapsed = new WeakSet();

  function init() {
    treeEl = document.getElementById('dom-tree');
    breadcrumbsEl = document.getElementById('status-breadcrumbs');

    ES.on((evt) => {
      if (evt === 'doc-changed' || evt === 'doc-replaced' || evt === 'history') render();
      if (evt === 'selection-changed') {
        render();
        renderBreadcrumbs();
      }
    });
  }

  function render() {
    const doc = ES.state.doc;
    if (!doc || !doc.body) { treeEl.innerHTML = '<div class="empty-list">No document</div>'; return; }
    treeEl.innerHTML = '';
    const root = renderNode(doc.body, 0);
    treeEl.appendChild(root);
  }

  function renderNode(el, depth) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (el === ES.state.selected) row.classList.add('selected');
    row.draggable = true;
    row.dataset.depth = depth;

    const children = Array.from(el.children);
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(el);

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = hasChildren ? (isCollapsed ? '▶' : '▼') : '·';
    if (hasChildren) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsed.has(el)) collapsed.delete(el); else collapsed.add(el);
        render();
      });
    }
    row.appendChild(toggle);

    const tag = document.createElement('span');
    tag.className = 'tree-tag';
    tag.textContent = el.tagName.toLowerCase();
    row.appendChild(tag);

    if (el.id) {
      const idEl = document.createElement('span');
      idEl.className = 'tree-id';
      idEl.textContent = '#' + el.id;
      row.appendChild(idEl);
    }
    if (el.classList && el.classList.length) {
      const cls = document.createElement('span');
      cls.className = 'tree-class';
      cls.textContent = '.' + Array.from(el.classList).slice(0, 2).join('.');
      row.appendChild(cls);
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      ES.select(el);
    });

    // Drag to reorder via tree
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      window.Canvas.setDragData({ type: 'move', element: el });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'move');
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      window.Canvas.clearDragData();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
      if (y < rect.height * 0.3) row.classList.add('drop-before');
      else if (y > rect.height * 0.7) row.classList.add('drop-after');
      else row.classList.add('drop-inside');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      let pos;
      if (y < rect.height * 0.3) pos = 'before';
      else if (y > rect.height * 0.7) pos = 'after';
      else pos = 'inside';
      row.classList.remove('drop-before', 'drop-after', 'drop-inside');

      const dd = window.Canvas.getDragData();
      if (!dd) return;
      try {
        if (dd.type === 'move' && dd.element) {
          if (dd.element === el || dd.element.contains(el)) return;
          window.Canvas.insertElement(dd.element, el, pos);
          ES.snapshot('move');
          ES.select(dd.element);
        } else if (dd.type === 'block' || dd.type === 'snippet') {
          const doc = ES.state.doc;
          const tpl = doc.createElement('template');
          tpl.innerHTML = (dd.html || '').trim();
          const inserted = tpl.content.firstElementChild;
          if (!inserted) return;
          window.Canvas.insertElement(inserted, el, pos);
          ES.snapshot('insert');
          ES.select(inserted);
        }
      } catch (err) { console.error(err); }
      window.Canvas.clearDragData();
    });

    node.appendChild(row);

    if (hasChildren && !isCollapsed) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'tree-children';
      for (const child of children) {
        childrenWrap.appendChild(renderNode(child, depth + 1));
      }
      node.appendChild(childrenWrap);
    }

    return node;
  }

  function renderBreadcrumbs() {
    breadcrumbsEl.innerHTML = '';
    const sel = ES.state.selected;
    if (!sel) {
      breadcrumbsEl.innerHTML = '<span style="color:var(--text-faint);">No selection</span>';
      return;
    }
    const chain = [];
    let node = sel;
    while (node && node !== ES.state.doc.documentElement) {
      chain.unshift(node);
      node = node.parentElement;
    }
    chain.unshift(ES.state.doc.documentElement);
    chain.forEach((el, i) => {
      const crumb = document.createElement('span');
      crumb.className = 'crumb';
      if (el === sel) crumb.classList.add('active');
      crumb.textContent = describe(el);
      crumb.addEventListener('click', () => ES.select(el));
      breadcrumbsEl.appendChild(crumb);
      if (i < chain.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = ' › ';
        breadcrumbsEl.appendChild(sep);
      }
    });
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + Array.from(el.classList).slice(0, 1).join('.');
    return s;
  }

  return { init };
})();
