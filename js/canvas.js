// Canvas: iframe management, selection, hover, drag-drop inside the canvas
window.Canvas = (function() {
  const ES = window.EditorState;
  let iframe, overlay, selBox, selLabel, selToolbar, hoverBox, dropIndicator;
  let canvasFrame;
  let isPreview = false;
  let dragData = null; // { type: 'block'|'move', payload, ghostEl? }

  // Inject styles into the iframe so editor selection works
  const IFRAME_STYLES = `
    [data-he-editing] { outline: 2px solid #6c8cff !important; outline-offset: -2px !important; }
    html { cursor: default; }
    body { min-height: 100vh; }
  `;

  function init() {
    iframe = document.getElementById('canvas');
    overlay = document.getElementById('selection-overlay');
    selBox = document.getElementById('sel-box');
    selLabel = document.getElementById('sel-label');
    selToolbar = document.getElementById('sel-toolbar');
    hoverBox = document.getElementById('hover-box');
    dropIndicator = document.getElementById('drop-indicator');
    canvasFrame = document.querySelector('.canvas-frame');

    // Selection toolbar buttons
    selToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      handleToolbarAction(action);
    });

    // Canvas resize observer to keep overlay aligned
    const ro = new ResizeObserver(() => updateOverlay());
    ro.observe(canvasFrame);

    // Listen to selection / doc state
    ES.on((evt, payload) => {
      if (evt === 'selection-changed') updateOverlay();
      if (evt === 'doc-replaced' || evt === 'doc-changed') {
        // After doc replacement we need to re-wire events
        wireIframeEvents();
        updateOverlay();
      }
    });

    // Window resize / scroll
    window.addEventListener('resize', updateOverlay);

    // Listen for drops on canvas wrap from external block drags
    const canvasWrap = document.querySelector('.canvas-wrap');
    canvasWrap.addEventListener('dragover', (e) => {
      if (!dragData) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      updateDropTarget(e.clientX, e.clientY);
    });
    canvasWrap.addEventListener('drop', (e) => {
      if (!dragData) return;
      e.preventDefault();
      handleDrop(e.clientX, e.clientY);
    });
    canvasWrap.addEventListener('dragleave', (e) => {
      if (e.target === canvasWrap) hideDropIndicator();
    });
  }

  function setDragData(d) { dragData = d; }
  function clearDragData() { dragData = null; hideDropIndicator(); }
  function getDragData() { return dragData; }

  function loadHtml(html) {
    if (!html || !html.trim()) {
      html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Untitled</title></head><body></body></html>';
    }
    iframe.srcdoc = html;
    iframe.onload = () => {
      const doc = iframe.contentDocument;
      injectEditorStyles(doc);
      ES.setDoc(doc);
      wireIframeEvents();
    };
  }

  function injectEditorStyles(doc) {
    const style = doc.createElement('style');
    style.id = '__he_styles__';
    style.textContent = IFRAME_STYLES;
    doc.head.appendChild(style);
  }

  function wireIframeEvents() {
    const doc = ES.state.doc;
    if (!doc) return;
    // Re-inject styles if they were lost (e.g., after undo via doc.write)
    if (!doc.getElementById('__he_styles__') && doc.head) injectEditorStyles(doc);
    const body = doc.body;
    if (!body) return;

    // Click to select
    body.addEventListener('click', (e) => {
      if (isPreview) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target;
      if (target && target.nodeType === 1 && target !== doc.documentElement && target !== body.parentNode) {
        ES.select(target);
      }
    }, true);

    // Double click to edit text. If the target is already in an editable
    // context, let the browser handle native word-selection — don't intercept.
    body.addEventListener('dblclick', (e) => {
      if (isPreview) return;
      const target = e.target;
      if (!target || target.nodeType !== 1) return;
      if (target.isContentEditable) return; // already editing — native word-select handles it
      e.preventDefault();
      e.stopPropagation();
      enterTextEdit(target, e);
    }, true);

    // Hover highlight
    body.addEventListener('mousemove', (e) => {
      if (isPreview) return;
      if (dragData) return;
      const target = e.target;
      if (target && target.nodeType === 1 && target !== ES.state.selected) {
        showHoverBox(target);
      } else {
        hideHoverBox();
      }
    });
    body.addEventListener('mouseleave', () => hideHoverBox());

    // Internal drag-drop: drag elements to reorder
    body.addEventListener('mousedown', (e) => {
      if (isPreview) return;
      if (!e.altKey && !e.shiftKey) return; // require modifier to start drag inside canvas
    });

    // Scroll: keep overlay in sync
    doc.addEventListener('scroll', updateOverlay, true);

    // dragover/drop inside iframe for blocks coming from sidebar
    doc.addEventListener('dragover', (e) => {
      if (!dragData) return;
      e.preventDefault();
      const rect = iframe.getBoundingClientRect();
      updateDropTarget(rect.left + e.clientX, rect.top + e.clientY);
    });
    doc.addEventListener('drop', (e) => {
      if (!dragData) return;
      e.preventDefault();
      const rect = iframe.getBoundingClientRect();
      handleDrop(rect.left + e.clientX, rect.top + e.clientY);
    });

    // Track any DOM mutations for autosave (excluding our editor-style injections)
    const mo = new MutationObserver((mutations) => {
      // Ignore mutations involving our injected style tag
      const meaningful = mutations.some(m => {
        if (m.target && m.target.id === '__he_styles__') return false;
        return true;
      });
      if (meaningful) {
        ES.scheduleAutosave();
        // Update overlay position if any layout changed
        updateOverlay();
      }
    });
    mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function enterTextEdit(el, mouseEvent) {
    if (!hasTextContentOnly(el)) {
      ES.select(el);
      return;
    }
    el.setAttribute('contenteditable', 'true');
    el.dataset.heEditing = 'true';
    el.focus();
    const onBlur = () => {
      el.removeAttribute('contenteditable');
      delete el.dataset.heEditing;
      ES.snapshot('edit text');
      el.removeEventListener('blur', onBlur);
    };
    el.addEventListener('blur', onBlur);

    const doc = el.ownerDocument;
    const win = doc.defaultView;
    const sel = win.getSelection();
    sel.removeAllRanges();

    // Try to place the caret at the click point and expand to the surrounding
    // word (mimics native double-click-to-select behavior).
    let placedAtClick = false;
    if (mouseEvent) {
      const x = mouseEvent.clientX, y = mouseEvent.clientY;
      let range = null;
      if (typeof doc.caretRangeFromPoint === 'function') {
        range = doc.caretRangeFromPoint(x, y);
      } else if (typeof doc.caretPositionFromPoint === 'function') {
        const pos = doc.caretPositionFromPoint(x, y);
        if (pos) {
          range = doc.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
      if (range && el.contains(range.startContainer)) {
        sel.addRange(range);
        try {
          sel.modify('move', 'backward', 'word');
          sel.modify('extend', 'forward', 'word');
        } catch (_) { /* Firefox/Safari may not support modify; caret stays where it is */ }
        placedAtClick = true;
      }
    }
    if (!placedAtClick) {
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.addRange(range);
    }
  }

  function hasTextContentOnly(el) {
    if (!el) return false;
    for (const child of el.childNodes) {
      if (child.nodeType === 1) return false; // element child = not text-only
    }
    return true;
  }

  function showHoverBox(el) {
    const rect = relRect(el);
    if (!rect) { hideHoverBox(); return; }
    hoverBox.hidden = false;
    Object.assign(hoverBox.style, {
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
  }
  function hideHoverBox() { hoverBox.hidden = true; }

  function relRect(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();          // iframe-local
    const ifr = iframe.getBoundingClientRect();    // iframe in parent
    const cf = canvasFrame.getBoundingClientRect();// canvas-frame in parent
    return {
      left: (ifr.left - cf.left) + r.left,
      top: (ifr.top - cf.top) + r.top,
      width: r.width,
      height: r.height,
    };
  }

  function updateOverlay() {
    const sel = ES.state.selected;
    if (!sel || isPreview) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    const rect = relRect(sel);
    if (!rect) {
      overlay.hidden = true;
      return;
    }
    Object.assign(selBox.style, {
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
    const label = describe(sel);
    selLabel.textContent = label;
    selLabel.style.left = rect.left + 'px';
    selLabel.style.top = (rect.top - 22) + 'px';
    if (rect.top - 22 < 0) {
      selLabel.style.top = rect.top + 'px';
    }

    // Context class — adds table/list helper buttons to the toolbar
    const ctx = selectionContext(sel);
    selToolbar.classList.toggle('ctx-table', ctx === 'table');
    selToolbar.classList.toggle('ctx-list', ctx === 'list');

    // Toolbar above selection (or below if near top); clamp horizontally
    requestAnimationFrame(() => {
      const tbRect = selToolbar.getBoundingClientRect();
      const tbW = tbRect.width || 200;
      const tbH = tbRect.height || 32;
      const frameRect = canvasFrame.getBoundingClientRect();
      const tbTop = rect.top - tbH - 8;
      const useBelow = tbTop < 0;
      const left = Math.max(4, Math.min(rect.left + rect.width - tbW, frameRect.width - tbW - 4));
      selToolbar.style.left = left + 'px';
      selToolbar.style.top = (useBelow ? rect.top + rect.height + 6 : tbTop) + 'px';
    });
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + Array.from(el.classList).slice(0, 2).join('.');
    return s;
  }

  function handleToolbarAction(action) {
    const sel = ES.state.selected;
    if (!sel) return;
    if (action === 'delete') deleteSelected();
    else if (action === 'duplicate') duplicateSelected();
    else if (action === 'parent') {
      if (sel.parentElement && sel.parentElement !== ES.state.doc.documentElement) ES.select(sel.parentElement);
    }
    else if (action === 'move-up') moveSelected(-1);
    else if (action === 'move-down') moveSelected(1);
    else if (action === 'row-before') tableAddRow(sel, false);
    else if (action === 'row-after')  tableAddRow(sel, true);
    else if (action === 'col-before') tableAddCol(sel, false);
    else if (action === 'col-after')  tableAddCol(sel, true);
    else if (action === 'row-delete') tableDeleteRow(sel);
    else if (action === 'col-delete') tableDeleteCol(sel);
    else if (action === 'li-before')  listAddItem(sel, false);
    else if (action === 'li-after')   listAddItem(sel, true);
  }

  // ---- Table helpers ----
  function findRow(el) { return el && el.closest && el.closest('tr'); }
  function findTable(el) { return el && el.closest && el.closest('table'); }
  function cellIndex(td) {
    // td.cellIndex exists for table cells; fall back to childIndex
    if (typeof td.cellIndex === 'number' && td.cellIndex >= 0) return td.cellIndex;
    return Array.prototype.indexOf.call(td.parentElement.children, td);
  }
  function tableAddRow(el, after) {
    const tr = findRow(el) || (findTable(el) && findTable(el).querySelector('tr'));
    if (!tr) return;
    const newRow = tr.cloneNode(true);
    Array.from(newRow.children).forEach(c => { c.textContent = ''; });
    if (after) tr.parentNode.insertBefore(newRow, tr.nextSibling);
    else tr.parentNode.insertBefore(newRow, tr);
    ES.snapshot('add row');
    ES.select(newRow.children[0] || newRow);
  }
  function tableAddCol(el, after) {
    const table = findTable(el);
    if (!table) return;
    let idx = 0;
    if (el.tagName === 'TD' || el.tagName === 'TH') idx = cellIndex(el);
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
      const ref = row.children[idx];
      if (!ref) {
        const cell = ES.state.doc.createElement(row.parentElement && row.parentElement.tagName === 'THEAD' ? 'th' : 'td');
        row.appendChild(cell);
        return;
      }
      const cell = ref.cloneNode(false);
      cell.textContent = '';
      if (after) row.insertBefore(cell, ref.nextSibling);
      else row.insertBefore(cell, ref);
    });
    ES.snapshot('add column');
  }
  function tableDeleteRow(el) {
    const tr = findRow(el);
    if (!tr) return;
    const next = tr.nextElementSibling || tr.previousElementSibling;
    tr.remove();
    ES.snapshot('delete row');
    if (next && next.children[0]) ES.select(next.children[0]);
    else ES.deselect();
  }
  function tableDeleteCol(el) {
    const table = findTable(el);
    if (!table || (el.tagName !== 'TD' && el.tagName !== 'TH')) return;
    const idx = cellIndex(el);
    table.querySelectorAll('tr').forEach(row => {
      if (row.children[idx]) row.children[idx].remove();
    });
    ES.snapshot('delete column');
    ES.deselect();
  }

  // ---- List helpers ----
  function listAddItem(el, after) {
    const li = el.closest && el.closest('li');
    if (!li) return;
    const newLi = li.cloneNode(true);
    newLi.textContent = 'Item';
    if (after) li.parentNode.insertBefore(newLi, li.nextSibling);
    else li.parentNode.insertBefore(newLi, li);
    ES.snapshot('add list item');
    ES.select(newLi);
  }

  function selectionContext(el) {
    if (!el) return null;
    if (el.closest && el.closest('table')) return 'table';
    if (el.closest && el.closest('ul, ol')) return 'list';
    return null;
  }

  function deleteSelected() {
    const sel = ES.state.selected;
    if (!sel || !sel.parentElement) return;
    if (sel === ES.state.doc.body || sel === ES.state.doc.documentElement) return;
    const next = sel.nextElementSibling || sel.previousElementSibling || sel.parentElement;
    sel.remove();
    ES.snapshot('delete');
    if (next) ES.select(next);
    else ES.deselect();
  }

  function duplicateSelected() {
    const sel = ES.state.selected;
    if (!sel || !sel.parentElement) return;
    if (sel === ES.state.doc.body || sel === ES.state.doc.documentElement) return;
    const clone = sel.cloneNode(true);
    sel.parentElement.insertBefore(clone, sel.nextSibling);
    ES.snapshot('duplicate');
    ES.select(clone);
  }

  function moveSelected(dir) {
    const sel = ES.state.selected;
    if (!sel || !sel.parentElement) return;
    if (dir < 0) {
      const prev = sel.previousElementSibling;
      if (prev) sel.parentElement.insertBefore(sel, prev);
    } else {
      const next = sel.nextElementSibling;
      if (next) sel.parentElement.insertBefore(next, sel);
    }
    ES.snapshot('move');
    updateOverlay();
  }

  // ---- Drop handling ----
  let lastDropTarget = null; // { el, position: 'before'|'after'|'inside' }

  function updateDropTarget(clientX, clientY) {
    const doc = ES.state.doc;
    if (!doc) return;
    const fr = iframe.getBoundingClientRect();
    const iframeX = clientX - fr.left;
    const iframeY = clientY - fr.top;
    if (iframeX < 0 || iframeY < 0 || iframeX > fr.width || iframeY > fr.height) {
      // Outside iframe — try body
      lastDropTarget = { el: doc.body, position: 'inside' };
      showDropIndicator(doc.body, 'inside');
      return;
    }
    const target = doc.elementFromPoint(iframeX, iframeY);
    if (!target || target === doc.documentElement) {
      lastDropTarget = { el: doc.body, position: 'inside' };
      showDropIndicator(doc.body, 'inside');
      return;
    }
    // Don't drop on the moving element itself
    if (dragData && dragData.type === 'move' && dragData.element &&
        (dragData.element === target || dragData.element.contains(target))) {
      hideDropIndicator();
      lastDropTarget = null;
      return;
    }
    const rect = target.getBoundingClientRect();
    const localY = iframeY - rect.top;
    const localX = iframeX - rect.left;
    let position;
    if (canContain(target)) {
      // Use thirds: top third = before, middle = inside, bottom = after
      if (localY < rect.height / 3) position = 'before';
      else if (localY > rect.height * 2 / 3) position = 'after';
      else position = 'inside';
    } else {
      // Inline-ish — left or right half
      position = localY < rect.height / 2 ? 'before' : 'after';
    }
    lastDropTarget = { el: target, position };
    showDropIndicator(target, position);
  }

  function canContain(el) {
    const tag = el.tagName.toLowerCase();
    const voidTags = ['img','input','br','hr','meta','link','source','area','base','col','embed','param','track','wbr'];
    if (voidTags.includes(tag)) return false;
    return true;
  }

  function showDropIndicator(el, position) {
    const rect = relRect(el);
    if (!rect) { hideDropIndicator(); return; }
    dropIndicator.hidden = false;
    dropIndicator.classList.remove('vertical', 'inside');
    if (position === 'inside') {
      dropIndicator.classList.add('inside');
      Object.assign(dropIndicator.style, {
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
      });
    } else if (position === 'before') {
      Object.assign(dropIndicator.style, {
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: rect.width + 'px',
        height: '2px',
      });
    } else {
      Object.assign(dropIndicator.style, {
        left: rect.left + 'px',
        top: (rect.top + rect.height - 2) + 'px',
        width: rect.width + 'px',
        height: '2px',
      });
    }
  }

  function hideDropIndicator() { dropIndicator.hidden = true; }

  function handleDrop(clientX, clientY) {
    if (!dragData || !lastDropTarget) { clearDragData(); return; }
    const doc = ES.state.doc;
    const { el, position } = lastDropTarget;

    let inserted = null;
    if (dragData.type === 'block') {
      const tpl = doc.createElement('template');
      tpl.innerHTML = dragData.html.trim();
      const frag = tpl.content;
      inserted = frag.firstElementChild;
      if (!inserted) { clearDragData(); return; }
      insertElement(inserted, el, position);
    } else if (dragData.type === 'move' && dragData.element) {
      const moving = dragData.element;
      if (moving === el || moving.contains(el)) { clearDragData(); return; }
      insertElement(moving, el, position);
      inserted = moving;
    } else if (dragData.type === 'snippet') {
      const tpl = doc.createElement('template');
      tpl.innerHTML = dragData.html.trim();
      const frag = tpl.content;
      inserted = frag.firstElementChild;
      if (!inserted) { clearDragData(); return; }
      insertElement(inserted, el, position);
    }
    ES.snapshot('insert');
    clearDragData();
    if (inserted) ES.select(inserted);
  }

  function insertElement(node, target, position) {
    if (position === 'before') {
      target.parentElement.insertBefore(node, target);
    } else if (position === 'after') {
      target.parentElement.insertBefore(node, target.nextSibling);
    } else {
      target.appendChild(node);
    }
  }

  function setPreview(p) {
    isPreview = p;
    if (p) {
      hideHoverBox();
      overlay.hidden = true;
    } else {
      updateOverlay();
    }
  }

  function setDevice(d) {
    canvasFrame.dataset.device = d;
    requestAnimationFrame(updateOverlay);
  }

  return {
    init, loadHtml, setDragData, clearDragData, getDragData, updateOverlay,
    deleteSelected, duplicateSelected, moveSelected, setPreview, setDevice,
    insertElement,
  };
})();
