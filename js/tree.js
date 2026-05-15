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

    const actions = document.createElement('span');
    actions.className = 'crumb-actions';
    actions.appendChild(makeCrumbBtn('copy', 'Copy element HTML', () => copyElementHtml(sel)));
    actions.appendChild(makeCrumbBtn('hash', 'Copy source line number(s)', () => copyLineNumbers(sel)));
    breadcrumbsEl.appendChild(actions);
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons({ attrs: { class: ['lucide'] }, nameAttr: 'data-lucide' });
    }
  }

  function makeCrumbBtn(icon, title, onClick) {
    const b = document.createElement('button');
    b.className = 'crumb-btn';
    b.title = title;
    b.type = 'button';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', icon);
    b.appendChild(i);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function copyElementHtml(el) {
    const html = el.outerHTML || '';
    writeClipboard(html, `Copied ${el.tagName.toLowerCase()} (${html.length} chars)`);
  }

  function copyLineNumbers(el) {
    const source = ES.state.sourceHtml || '';
    if (!source) { toast('No source available', 'warn'); return; }
    const path = ES.pathTo(el);
    if (!path) { toast('Could not resolve element path', 'warn'); return; }
    const range = locateInSource(source, path);
    if (!range) { toast('Could not locate element in source', 'warn'); return; }
    const text = range.startLine === range.endLine
      ? String(range.startLine)
      : `${range.startLine}-${range.endLine}`;
    const noteSuffix = ES.state.dirty ? ' (source may be stale — unsaved edits)' : '';
    writeClipboard(text, `Copied line ${text}${noteSuffix}`);
  }

  function writeClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast(successMsg, 'success'),
        () => toast('Copy failed — clipboard blocked', 'error')
      );
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(successMsg, 'success'); }
      catch { toast('Copy failed', 'error'); }
      ta.remove();
    }
  }

  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    const host = document.getElementById('toasts');
    if (!host) return;
    host.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // ---- Source line locator ----
  // Tokenize the source HTML and walk it with the same child-index path used
  // by ES.pathTo so we can return the source line(s) of the target element.
  // Best-effort: assumes well-formed HTML. Implicit closes (<li>, <p>, <tr>
  // without closing tags) can throw off the path; in those cases the result
  // may be off or null.
  const VOID_ELS = new Set(['area','base','br','col','embed','hr','img','input','keygen','link','meta','param','source','track','wbr']);
  const RAW_TEXT_ELS = new Set(['script','style','textarea','title']);

  function tokenizeHtml(source) {
    const tokens = [];
    let pos = 0;
    while (pos < source.length) {
      const lt = source.indexOf('<', pos);
      if (lt === -1) break;
      // Comment
      if (source.startsWith('<!--', lt)) {
        const e = source.indexOf('-->', lt + 4);
        pos = e === -1 ? source.length : e + 3;
        continue;
      }
      // Doctype, processing instruction, CDATA — skip
      if (source[lt + 1] === '!' || source[lt + 1] === '?') {
        const e = source.indexOf('>', lt);
        pos = e === -1 ? source.length : e + 1;
        continue;
      }
      const isClose = source[lt + 1] === '/';
      const nameStart = lt + (isClose ? 2 : 1);
      const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(source.slice(nameStart));
      if (!nameMatch) { pos = lt + 1; continue; }
      const tagName = nameMatch[0].toLowerCase();
      // Find tag end, respecting quoted attributes
      let end = nameStart + nameMatch[0].length;
      let inQuote = null;
      while (end < source.length) {
        const ch = source[end];
        if (inQuote) {
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === '>') {
          break;
        }
        end++;
      }
      if (end >= source.length) break;
      const selfClose = !isClose && source[end - 1] === '/';
      tokens.push({ tag: tagName, isClose, selfClose, start: lt, end });
      pos = end + 1;
      // Raw-text: skip content until matching close tag
      if (!isClose && !selfClose && RAW_TEXT_ELS.has(tagName)) {
        const re = new RegExp('</' + tagName + '\\b', 'i');
        const m = re.exec(source.slice(pos));
        if (m) pos = pos + m.index;
      }
    }
    return tokens;
  }

  function findCloseToken(tokens, openIdx, tagName) {
    let depth = 1;
    for (let j = openIdx + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.tag !== tagName) continue;
      if (t.isClose) {
        depth--;
        if (depth === 0) return j;
      } else if (!t.selfClose && !VOID_ELS.has(t.tag)) {
        depth++;
      }
    }
    return -1;
  }

  function lineNumber(source, offset) {
    let n = 1;
    const stop = Math.min(offset, source.length);
    for (let i = 0; i < stop; i++) {
      if (source.charCodeAt(i) === 10) n++;
    }
    return n;
  }

  function locateInSource(source, path) {
    const tokens = tokenizeHtml(source);
    let htmlIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i].isClose && tokens[i].tag === 'html') { htmlIdx = i; break; }
    }
    if (htmlIdx === -1) return null;
    if (path.length === 0) {
      const closeIdx = findCloseToken(tokens, htmlIdx, 'html');
      const endTok = closeIdx >= 0 ? tokens[closeIdx] : tokens[htmlIdx];
      return { startLine: lineNumber(source, tokens[htmlIdx].start), endLine: lineNumber(source, endTok.end) };
    }
    return descend(source, tokens, htmlIdx, path, 0);
  }

  function descend(source, tokens, parentOpenIdx, path, depth) {
    const parent = tokens[parentOpenIdx];
    if (parent.selfClose || VOID_ELS.has(parent.tag)) return null;
    const closeIdx = findCloseToken(tokens, parentOpenIdx, parent.tag);
    const stop = closeIdx === -1 ? tokens.length : closeIdx;
    const targetIdx = path[depth];
    let childCount = 0;
    let i = parentOpenIdx + 1;
    while (i < stop) {
      const tok = tokens[i];
      if (tok.isClose) { i++; continue; }
      const isContainer = !tok.selfClose && !VOID_ELS.has(tok.tag);
      if (childCount === targetIdx) {
        if (depth === path.length - 1) {
          let endTok = tok;
          if (isContainer) {
            const ci = findCloseToken(tokens, i, tok.tag);
            if (ci >= 0) endTok = tokens[ci];
          }
          return {
            startLine: lineNumber(source, tok.start),
            endLine: lineNumber(source, endTok.end),
          };
        }
        return descend(source, tokens, i, path, depth + 1);
      }
      childCount++;
      if (isContainer) {
        const ci = findCloseToken(tokens, i, tok.tag);
        i = ci === -1 ? stop : ci + 1;
      } else {
        i++;
      }
    }
    return null;
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + Array.from(el.classList).slice(0, 1).join('.');
    return s;
  }

  return { init };
})();
