// Images and the Site panel.
//
// Every way of adding an image (dropping a file on the page, pasting, the
// Upload button, double-clicking an image, the Site panel) goes through
// importImage(), which picks how the image is stored:
//   - Site folder open with write access: copy it into the folder (reusing an
//     identical file that's already there) and link it with a relative path.
//   - Otherwise: embed it in the HTML as a data URI, offering to shrink big
//     photos first so the file stays a sane size.
window.Assets = (function() {
  const ES = window.EditorState;
  const EMBED_WARN_BYTES = 1.5 * 1024 * 1024;
  const SHRINK_MAX_PX = 1600;
  const MAX_THUMBS = 300;
  let thumbUrls = [];
  let imageFilter = '';

  function init() {
    const add = document.getElementById('site-add-images');
    if (add) add.addEventListener('click', async () => {
      const files = await pickImages(true);
      if (files.length) await insertFiles(files, null);
    });
    const open = document.getElementById('site-open-folder');
    if (open) open.addEventListener('click', () => window.Site.openFolder());
    const filter = document.getElementById('site-image-filter');
    if (filter) filter.addEventListener('input', () => { imageFilter = filter.value.toLowerCase(); renderImages(); });

    // Paste images anywhere in the editor (the canvas has its own listener
    // because iframe events don't bubble to the parent document).
    document.addEventListener('paste', handlePaste);

    ES.on((evt) => {
      if (evt === 'site-changed') render();
    });
    render();
  }

  function isImageFile(f) {
    return !!f && ((f.type && f.type.startsWith('image/')) || window.Site.IMAGE_EXT.test(f.name || ''));
  }

  // ---------- Storage decision ----------

  // Returns the URL to put in src / url(), or null if cancelled or failed.
  async function importImage(file) {
    if (!isImageFile(file)) { toast(`${file.name} isn't an image`, 'warn'); return null; }
    const site = window.Site.active();
    if (site) {
      const same = await window.Site.findSame(file).catch(() => null);
      if (same) {
        toast(`Linked existing ${same}`, 'success');
        return window.Site.relFromPage(same);
      }
      if (site.writable) {
        try {
          const dir = window.Site.assetDir();
          const path = await window.Site.writeNewFile(dir, file.name || defaultName(file), file);
          toast(`Copied into ${path}`, 'success');
          return window.Site.relFromPage(path);
        } catch (e) {
          toast(`Couldn't copy into the folder (${e.message}). Embedding instead.`, 'warn');
        }
      }
    }
    return embed(file);
  }

  async function embed(file) {
    let blob = file;
    const shrinkable = /^image\/(jpeg|png|webp)$/.test(file.type);
    if (file.size > EMBED_WARN_BYTES && shrinkable) {
      const shrink = await window.Dialog.confirm({
        title: `${file.name || 'This image'} is ${mb(file.size)}`,
        message: `Embedding it puts the whole image inside your HTML file, which makes the page slow to load and edit. Shrink it to ${SHRINK_MAX_PX}px wide first? (Tip: open your site folder instead, and images are saved as separate files.)`,
        confirmLabel: 'Shrink and embed',
        cancelLabel: 'Embed full size',
      });
      if (shrink) blob = await shrinkImage(file).catch(() => file);
    }
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    }).catch(() => null);
    if (!url) { toast('Could not read the image', 'error'); return null; }
    if (!localStorage.getItem('html-editor.hint.embed')) {
      localStorage.setItem('html-editor.hint.embed', '1');
      toast('Image embedded in the page. To keep images as separate files, use Open Folder.', '');
    }
    return url;
  }

  async function shrinkImage(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, SHRINK_MAX_PX / bmp.width);
    if (scale === 1) { bmp.close && bmp.close(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close && bmp.close();
    const out = await new Promise(res => canvas.toBlob(res, file.type, 0.85));
    return out && out.size < file.size ? out : file;
  }

  // ---------- Inserting ----------

  // target = { el, position } from the canvas drop indicator, or null to
  // insert after the selection (or at the end of the page).
  async function insertFiles(files, target) {
    const doc = ES.state.doc;
    if (!doc) return;
    target = normalizeTarget(target);
    let last = null;
    for (const file of files) {
      const url = await importImage(file);
      if (!url) continue;
      if (!last && target.el.tagName === 'IMG' && target.position === 'inside') {
        setImageSrc(target.el, url);
        last = target.el;
        continue;
      }
      last = insertImg(url, altFrom(file.name), last ? { el: last, position: 'after' } : target);
    }
    if (last) {
      ES.snapshot('add image');
      ES.select(last);
    }
  }

  async function insertUrl(url, target) {
    const doc = ES.state.doc;
    if (!doc || !/^(https?:|data:image\/)/i.test(url)) {
      if (url) toast('Only image files or http(s) image links can be dropped here', 'warn');
      return;
    }
    target = normalizeTarget(target);
    let el;
    if (target.el.tagName === 'IMG' && target.position === 'inside') { setImageSrc(target.el, url); el = target.el; }
    else el = insertImg(url, '', target);
    ES.snapshot('add image');
    ES.select(el);
  }

  function normalizeTarget(target) {
    const doc = ES.state.doc;
    if (target && target.el && target.el.isConnected && target.el.ownerDocument === doc) {
      if (target.el === doc.body || target.el === doc.documentElement) return { el: doc.body, position: 'inside' };
      return target;
    }
    const sel = ES.state.selected;
    if (sel && sel.isConnected && sel !== doc.body && sel !== doc.documentElement && sel.parentElement) {
      return { el: sel, position: sel.tagName === 'IMG' ? 'inside' : 'after' };
    }
    return { el: doc.body, position: 'inside' };
  }

  function insertImg(url, alt, target) {
    const doc = ES.state.doc;
    const img = doc.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('alt', alt || '');
    img.setAttribute('style', 'max-width:100%;height:auto;');
    const t = target.el.tagName === 'IMG' && target.position === 'inside' ? { el: target.el, position: 'after' } : target;
    window.Canvas.insertElement(img, t.el, t.position);
    return img;
  }

  // Replace an <img>'s source. srcset/sizes (and <picture> <source>s) would
  // keep showing the old image, so they go too; this is one undo step.
  function setImageSrc(img, url) {
    img.setAttribute('src', url);
    const had = img.hasAttribute('srcset');
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
    const sources = pic ? Array.from(pic.querySelectorAll(':scope > source')) : [];
    sources.forEach(s => s.remove());
    if (had || sources.length) toast('Removed the old responsive sizes (srcset) so the new image shows. Undo with ⌘Z.', '');
  }

  async function replaceImage(img) {
    const [file] = await pickImages(false);
    if (!file) return;
    const url = await importImage(file);
    if (!url || !img.isConnected) return;
    setImageSrc(img, url);
    ES.snapshot('replace image');
    ES.select(img);
    window.Canvas.updateOverlay();
  }

  // For url() style fields (background image). Resolves to a URL or null.
  async function pickImageUrl() {
    const [file] = await pickImages(false);
    return file ? importImage(file) : null;
  }

  function pickImages(multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.svg,.avif,.ico';
      input.multiple = !!multiple;
      let done = false;
      input.addEventListener('change', () => { done = true; resolve(Array.from(input.files || [])); });
      input.addEventListener('cancel', () => { if (!done) resolve([]); });
      input.click();
    });
  }

  function handlePaste(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (t && t.closest && t.closest('.cm-editor, .dialog-panel')) return;
    if (!ES.state.doc || ES.state.mode !== 'visual' || document.getElementById('editor').hidden) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(isImageFile);
    if (!files.length) return;
    // While typing into text, copied text wins (apps like Word put an image
    // of the text on the clipboard too).
    if (t && t.isContentEditable && e.clipboardData.types.includes('text/plain')) return;
    e.preventDefault();
    const named = files.map((f, i) => (f.name && f.name !== 'image.png') ? f
      : new File([f], defaultName(f, i), { type: f.type, lastModified: Date.now() }));
    insertFiles(named, null);
  }

  // ---------- Site panel ----------

  function render() {
    const site = window.Site.active();
    const none = document.getElementById('site-none');
    const open = document.getElementById('site-open');
    if (!none || !open) return;
    none.hidden = !!site;
    open.hidden = !site;
    const reopen = document.getElementById('site-reopen');
    if (!site) {
      window.Site.getLastFolder().then(h => {
        if (!reopen) return;
        reopen.hidden = !h;
        if (h) {
          reopen.textContent = `Reopen ${h.name}`;
          reopen.onclick = () => window.Site.reopenLast();
        }
      });
      renderImages();
      return;
    }
    document.getElementById('site-name').textContent = site.name + (site.writable ? '' : ' (read-only)');
    document.getElementById('site-name').title = site.writable
      ? 'Saving writes to these files. New images are copied into the folder.'
      : 'Read-only: Save downloads the page, new images are embedded in it.';
    renderPages();
    renderImages();
  }

  function renderRoot() {
    const sel = document.getElementById('site-root');
    if (!sel) return;
    const site = window.Site.active();
    const choices = window.Site.rootChoices();
    sel.innerHTML = '';
    for (const r of choices) {
      const o = document.createElement('option');
      o.value = r;
      o.textContent = r ? '/' + r : '/ (the folder you opened)';
      if (r === (site.webRoot || '')) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => window.Site.setWebRoot(sel.value);
    sel.closest('.site-root-row').hidden = choices.length < 2;
  }

  function renderPages() {
    renderRoot();
    const list = document.getElementById('site-pages');
    const site = window.Site.active();
    const root = site.webRoot || '';
    list.innerHTML = '';
    for (const p of window.Site.listPages()) {
      const item = document.createElement('div');
      item.className = 'recent-item site-page' + (p === site.pagePath ? ' active' : '');
      item.title = p === site.pagePath ? 'Open now' : 'Open ' + p;
      const name = document.createElement('span');
      name.className = 'site-page-name';
      name.textContent = p.slice(root.length);
      item.appendChild(name);
      if (p !== site.pagePath) item.addEventListener('click', () => window.Site.openPage(p));
      list.appendChild(item);
    }
  }

  async function renderImages() {
    const grid = document.getElementById('site-images');
    if (!grid) return;
    thumbUrls.forEach(u => URL.revokeObjectURL(u));
    thumbUrls = [];
    grid.innerHTML = '';
    if (!window.Site.active()) return;
    const all = window.Site.listImages().filter(p => !imageFilter || p.toLowerCase().includes(imageFilter));
    const count = document.getElementById('site-image-count');
    if (count) count.textContent = all.length ? `(${all.length})` : '';
    if (!all.length) {
      grid.innerHTML = `<div class="empty-list">${imageFilter ? 'No matching images' : 'No images in this folder yet'}</div>`;
      return;
    }
    for (const path of all.slice(0, MAX_THUMBS)) {
      const tile = document.createElement('div');
      tile.className = 'site-image';
      tile.draggable = true;
      tile.title = `${path}\nClick: use for the selected image, or insert after the selection.\nDrag: drop onto the page.`;
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = path.split('/').pop();
      tile.appendChild(img);
      tile.appendChild(label);
      tile.addEventListener('click', () => useSiteImage(path));
      tile.addEventListener('dragstart', (e) => {
        const rel = window.Site.relFromPage(path);
        window.Canvas.setDragData({
          type: 'block', name: path,
          html: `<img src="${escapeAttr(rel)}" alt="${escapeAttr(altFrom(path))}" style="max-width:100%;height:auto;">`,
        });
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', path);
      });
      tile.addEventListener('dragend', () => window.Canvas.clearDragData());
      grid.appendChild(tile);
      window.Site.getFile(path).then(f => {
        if (!f || !tile.isConnected) return;
        const u = URL.createObjectURL(f);
        thumbUrls.push(u);
        img.src = u;
      });
    }
    if (all.length > MAX_THUMBS) {
      const more = document.createElement('div');
      more.className = 'empty-list';
      more.textContent = `Showing ${MAX_THUMBS} of ${all.length}. Type to filter.`;
      grid.appendChild(more);
    }
  }

  function useSiteImage(path) {
    const doc = ES.state.doc;
    if (!doc) return;
    const rel = window.Site.relFromPage(path);
    const sel = ES.state.selected;
    if (sel && sel.tagName === 'IMG') {
      setImageSrc(sel, rel);
      ES.snapshot('replace image');
      window.Canvas.updateOverlay();
      return;
    }
    const el = insertImg(rel, altFrom(path), normalizeTarget(null));
    ES.snapshot('add image');
    ES.select(el);
  }

  // ---------- helpers ----------

  function altFrom(name) {
    const base = String(name || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    // Pasted screenshots and camera names ("IMG_1234") say nothing useful.
    if (/^(pasted-\d|image$|img[_-]?\d+$|dsc[_-]?\d+$|screenshot)/i.test(base)) return '';
    return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function defaultName(file, i = 0) {
    const ext = ((file.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    return `pasted-${stamp}${i ? '-' + i : ''}.${ext}`;
  }
  function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }
  function escapeAttr(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), type === 'warn' || type === 'error' ? 5000 : 3200);
  }

  return {
    init, isImageFile, importImage, insertFiles, insertUrl, replaceImage, pickImageUrl,
    setImageSrc, handlePaste, toast,
  };
})();
