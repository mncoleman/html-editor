// Site folder mode: open a whole website folder instead of a single file so
// the page's linked CSS, images, fonts and scripts resolve on the canvas,
// images can be copied into the folder, and you can hop between pages.
//
// How the linked files reach the canvas: the canvas document gets an injected
// <base id="__he_base__" href="<scope>/__site__/<token>/<page dir>/"> (stripped
// on every save/serialize path via ES.stripTraces). Requests from the canvas go
// through sw.js, which hands them back to the responder this module installs
// on the canvas frame. Root-absolute URLs ("/css/site.css") map to the folder
// root. Folder access:
//   - 'fsa'   File System Access API (Chrome/Edge/Arc): read + write.
//   - 'files' <input webkitdirectory> or a dropped folder in Safari, Firefox
//             and Brave: read-only, Save downloads the page instead.
window.Site = (function() {
  const ES = window.EditorState;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
  const PAGE_EXT = /\.html?$/i;
  const SKIP = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.next', '.cache', '.DS_Store']);
  const MAX_FILES = 20000;
  const MIME = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json',
    map: 'application/json', txt: 'text/plain; charset=utf-8', xml: 'application/xml', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject', mp4: 'video/mp4',
    webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf',
    wasm: 'application/wasm', webmanifest: 'application/manifest+json',
  };
  const PREFIX = new URL('__site__/', new URL('./', location.href)).pathname;

  // site = { token, name, kind:'fsa'|'files', root, entries: Map<path,{handle?,file?}>,
  //          lower: Map<lowercased path, path>, pagePath, writable }
  let site = null;
  let swReady = null;
  const wiredFrames = new WeakSet(); // ServiceWorkerContainers already answering

  function init() {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      swReady = navigator.serviceWorker.register('sw.js', { scope: './' }).catch((e) => {
        console.warn('[site] service worker registration failed', e);
        return null;
      });
      navigator.serviceWorker.addEventListener('message', onEditorMessage);
    }
    const input = document.getElementById('folder-input');
    if (input) {
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length) await openFromFileList(files);
      });
    }
  }

  function active() { return site; }
  function supportsDirPicker() { return 'showDirectoryPicker' in window && window.isSecureContext; }

  // ---------- Opening ----------

  async function openFolder() {
    if (!(await confirmLeave('Open a different folder?'))) return false;
    if (supportsDirPicker()) {
      let root;
      try {
        root = await window.showDirectoryPicker({ id: 'he-site', mode: 'readwrite' });
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        toast('Could not open folder: ' + e.message, 'error');
        return false;
      }
      return openFromHandle(root, { skipConfirm: true });
    }
    document.getElementById('folder-input').click();
    return false;
  }

  async function openFromHandle(root, opts = {}) {
    if (!opts.skipConfirm && !(await confirmLeave('Open this folder?'))) return false;
    const writable = await ensureWritePermission(root);
    const next = { token: newToken(), name: root.name, kind: 'fsa', root, entries: new Map(), lower: new Map(), pagePath: null, writable };
    status(`Reading ${root.name}…`);
    try { await walkHandle(root, '', next); }
    catch (e) { toast('Could not read folder: ' + e.message, 'error'); status(''); return false; }
    status('');
    saveLastFolder(root);
    return activate(next);
  }

  // Write access to a folder. The picker grants it up front; a folder that was
  // dropped on the window, or reopened from last time, needs the browser's
  // permission prompt, and that prompt only appears right after a click. So if
  // the direct request is refused, ask in our own dialog and request again from
  // its button.
  async function ensureWritePermission(root) {
    if (!root.queryPermission) return true;
    let perm = 'prompt';
    try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch (_) {}
    if (perm === 'granted') return true;
    try { perm = await root.requestPermission({ mode: 'readwrite' }); } catch (_) { perm = 'prompt'; }
    if (perm === 'granted') return true;
    if (perm === 'denied') return false;
    const ok = await window.Dialog.confirm({
      title: `Allow saving to ${root.name}?`,
      message: 'The browser will ask once more. Allowing it lets Save write your edits back to these files and copy new images into the folder. Without it, the folder opens read-only.',
      confirmLabel: 'Allow saving',
      cancelLabel: 'Read-only',
    });
    if (!ok) return false;
    try { return (await root.requestPermission({ mode: 'readwrite' })) === 'granted'; }
    catch (_) { return false; }
  }

  async function openFromFileList(files) {
    if (!(await confirmLeave('Open this folder?'))) return false;
    const first = files[0].webkitRelativePath || files[0].name;
    const name = first.includes('/') ? first.split('/')[0] : 'folder';
    const next = { token: newToken(), name, kind: 'files', root: null, entries: new Map(), lower: new Map(), pagePath: null, writable: false };
    for (const f of files) {
      const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
      if (rel.split('/').some(seg => SKIP.has(seg) || seg.startsWith('.'))) continue;
      addEntry(next, rel, { file: f });
      if (next.entries.size >= MAX_FILES) break;
    }
    return activate(next);
  }

  // Folder dropped in a browser without File System Access (old-style entries API)
  async function openFromEntry(dirEntry) {
    if (!(await confirmLeave('Open this folder?'))) return false;
    const next = { token: newToken(), name: dirEntry.name, kind: 'files', root: null, entries: new Map(), lower: new Map(), pagePath: null, writable: false };
    status(`Reading ${dirEntry.name}…`);
    await walkEntry(dirEntry, '', next);
    status('');
    return activate(next);
  }

  async function activate(next) {
    next.webRoot = detectWebRoot(next);
    const pages = listPages(next);
    if (!pages.length) {
      toast(`No .html pages found in ${next.name}`, 'warn');
      return false;
    }
    site = next;
    const swOk = await ensureController();
    const start = pages.find(p => p === next.webRoot + 'index.html' || p === next.webRoot + 'index.htm') || pages[0];
    await openPage(start, { skipConfirm: true });
    ES.emit('site-changed');
    showAssetsTab();
    if (!swOk) toast('This browser blocked the helper that loads linked CSS and images, so the page may look unstyled. Editing and saving still work.', 'warn');
    else if (isBuildOutput()) toast(`${site.webRoot} looks like build output (there's a package.json here). Edits to it are fine for trying things out, but your next build will replace them. Make lasting changes in the source files.`, 'warn');
    else if (!site.writable) toast(`Opened ${site.name} read-only. Save downloads the page; new images are embedded in it.`, '');
    else toast(`Opened ${site.name}. Edits save to disk; new images are copied into the folder.`, 'success');
    return true;
  }

  // Page switches run one at a time: two quick clicks must not leave the
  // canvas on one page while relative paths are computed for another.
  let openQueue = Promise.resolve();
  function openPage(path, opts = {}) {
    const run = openQueue.then(() => openPageNow(path, opts));
    openQueue = run.catch(() => {});
    return run;
  }
  async function openPageNow(path, opts) {
    if (!site) return false;
    const s = site;
    const entry = s.entries.get(path);
    if (!entry) { toast('Page not found: ' + path, 'error'); return false; }
    if (!opts.skipConfirm && !(await confirmLeave(`Open ${path}?`))) return false;
    if (site !== s) return false;
    const prev = s.pagePath;
    s.pagePath = path;
    const display = s.name + '/' + path;
    const ok = s.kind === 'fsa'
      ? await window.FileOps.loadFromHandle(entry.handle, { keepSite: true, displayName: display })
      : await window.FileOps.importFile(entry.file, { keepSite: true, displayName: display });
    if (!ok) s.pagePath = prev;
    ES.emit('site-changed');
    return ok;
  }

  // Called by FileOps when a plain single file is opened/imported/created.
  function detach() {
    if (!site) return;
    site = null;
    ES.emit('site-changed');
  }

  async function confirmLeave(what) {
    if (!ES.state.dirty || !ES.state.doc) return true;
    return window.Dialog.confirm({
      title: 'Unsaved changes',
      message: `${what} Your unsaved edits to ${ES.state.fileName} will be lost. Save first with ⌘S if you want to keep them.`,
      confirmLabel: 'Discard and continue',
      cancelLabel: 'Cancel',
      danger: true,
    });
  }

  // ---------- Index ----------

  async function walkHandle(dir, prefix, into) {
    for await (const [name, handle] of dir.entries()) {
      if (into.entries.size >= MAX_FILES) return;
      if (SKIP.has(name) || name.startsWith('.')) continue;
      const path = prefix ? prefix + '/' + name : name;
      if (handle.kind === 'directory') await walkHandle(handle, path, into);
      else addEntry(into, path, { handle });
    }
  }

  async function walkEntry(dirEntry, prefix, into) {
    const reader = dirEntry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
      if (!batch.length) break;
      for (const ent of batch) {
        if (into.entries.size >= MAX_FILES) return;
        if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
        const path = prefix ? prefix + '/' + ent.name : ent.name;
        if (ent.isDirectory) await walkEntry(ent, path, into);
        else {
          const file = await new Promise((res, rej) => ent.file(res, rej)).catch(() => null);
          if (file) addEntry(into, path, { file });
        }
      }
    }
  }

  function addEntry(into, path, entry) {
    into.entries.set(path, entry);
    into.lower.set(path.toLowerCase(), path);
  }

  function listPages(s = site) {
    if (!s) return [];
    const r = s.webRoot || '';
    return Array.from(s.entries.keys()).filter(p => PAGE_EXT.test(p) && p.startsWith(r))
      .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  }
  function listImages(s = site) {
    if (!s) return [];
    const r = s.webRoot || '';
    return Array.from(s.entries.keys()).filter(p => IMAGE_EXT.test(p) && p.startsWith(r)).sort((a, b) => a.localeCompare(b));
  }
  function depth(p) { return p.split('/').length; }

  async function getFile(path) {
    if (!site) return null;
    let key = site.entries.has(path) ? path : site.lower.get(path.toLowerCase());
    if (!key && site.kind === 'fsa') {
      // Not in the index (created after the folder was opened)? Look it up.
      const handle = await resolveHandle(path);
      if (handle) { addEntry(site, path, { handle }); key = path; }
    }
    if (!key) return null;
    const entry = site.entries.get(key);
    try { return entry.file || await entry.handle.getFile(); }
    catch (_) { return null; }
  }

  async function resolveHandle(path) {
    try {
      const segs = path.split('/');
      let dir = site.root;
      for (let i = 0; i < segs.length - 1; i++) dir = await dir.getDirectoryHandle(segs[i]);
      return await dir.getFileHandle(segs[segs.length - 1]);
    } catch (_) { return null; }
  }

  // ---------- Serving (canvas frame + preview tab) ----------

  // Install the responder on a canvas frame window. Must run BEFORE the frame
  // document's content is written so the first wave of subresource requests
  // gets answered (Canvas.loadHtml writes into a blank srcdoc for this reason).
  function attachResponder(win) {
    try {
      // Key on the ServiceWorkerContainer, not the window: contentWindow is a
      // WindowProxy that stays the same object across srcdoc navigations,
      // while each new frame document gets a fresh container.
      const container = win && win.navigator && win.navigator.serviceWorker;
      if (!container || wiredFrames.has(container)) return;
      wiredFrames.add(container);
      container.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.type !== 'he-site-fetch' || !e.ports[0]) return;
        answerFrame(d.path).then(ans => e.ports[0].postMessage(ans), () => e.ports[0].postMessage({ status: 500 }));
      });
    } catch (_) { /* cross-origin or no SW support */ }
  }

  async function answerFrame(pathname) {
    if (!site) return { pass: true };
    let sitePath;
    if (pathname.startsWith(PREFIX)) {
      const rest = pathname.slice(PREFIX.length);
      const slash = rest.indexOf('/');
      if (rest.slice(0, slash < 0 ? undefined : slash) !== site.token) return { status: 404 };
      sitePath = encodePath(webRoot()) + (slash < 0 ? '' : rest.slice(slash + 1));
    } else {
      sitePath = encodePath(webRoot()) + pathname.slice(1); // root-absolute "/x" = site root
    }
    return serve(sitePath, false);
  }

  function onEditorMessage(e) {
    const d = e.data;
    if (!d || d.type !== 'he-site-fetch' || !d.token || !e.ports[0]) return;
    if (!site || d.token !== site.token) { e.ports[0].postMessage({ pass: true }); return; }
    serve(encodePath(webRoot()) + (d.sitePath || ''), true).then(ans => e.ports[0].postMessage(ans), () => e.ports[0].postMessage({ status: 500 }));
  }

  async function serve(rawPath, isPreview) {
    let path;
    try { path = rawPath.split('/').map(decodeURIComponent).join('/'); }
    catch (_) { return { status: 400 }; }
    // Hidden files and folders (.env, .git/…) are never served, matching the
    // index, which skips them too.
    if (path.split('/').some(seg => seg.startsWith('.'))) return { status: 404 };
    if (path === '' || path.endsWith('/')) path += 'index.html';
    // The preview tab shows the page as currently edited, not the disk copy.
    if (isPreview && path === site.pagePath && window.FileOps) {
      return { status: 200, body: new Blob([window.FileOps.currentHtml()]), type: MIME.html };
    }
    let file = await getFile(path);
    if (!file && !/\.[a-z0-9]+$/i.test(path)) file = await getFile(path + '/index.html') || await getFile(path + '.html');
    if (!file) return { status: 404 };
    const ext = (path.split('.').pop() || '').toLowerCase();
    return { status: 200, body: file, type: MIME[ext] || file.type || 'application/octet-stream' };
  }

  async function ensureController() {
    if (!swReady) return false;
    const reg = await swReady;
    if (!reg) return false;
    if (navigator.serviceWorker.controller) return true;
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 4000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
      // After a hard reload the page starts uncontrolled; ask the worker to claim it.
      navigator.serviceWorker.ready.then(r => r.active && r.active.postMessage({ type: 'he-claim' }));
    });
    return !!navigator.serviceWorker.controller;
  }

  // The canvas can only show the folder's files if the browser lets the
  // service worker see requests from srcdoc frames (Chrome 135+, Firefox 136+).
  let warnedFrame = false;
  function checkFrame(win) {
    if (!site || warnedFrame) return;
    try {
      if (navigator.serviceWorker.controller && !win.navigator.serviceWorker.controller) {
        warnedFrame = true;
        toast('This browser version can\'t show the folder\'s CSS and images inside the editor (it needs Chrome 135+ or Firefox 136+). Editing and saving still work, and the new-tab preview shows the real page.', 'warn');
      }
    } catch (_) {}
  }

  // ---------- URL helpers ----------

  function pageDir() {
    if (!site || !site.pagePath) return '';
    const i = site.pagePath.lastIndexOf('/');
    return i < 0 ? '' : site.pagePath.slice(0, i + 1);
  }
  // Directory that relative URLs on the current page resolve against: the
  // page's folder, or the folder its own <base href> points at.
  function baseDir() {
    return site && site.baseDir != null ? site.baseDir : pageDir();
  }
  function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

  // The site root: the folder that "/" means on the live site. Usually the
  // folder you opened, but for a build output (Next.js out/, dist/, build/,
  // _site/) it's that subfolder, or "/_next/…" and "/css/…" won't resolve.
  // The editor's virtual URL space (/__site__/<token>/…) mirrors this root.
  function isBuildOutput() {
    return !!site && /^(out|dist|build|_site|\.next|\.output)\/$/i.test(site.webRoot || '') && site.entries.has('package.json');
  }
  function webRoot() { return (site && site.webRoot) || ''; }
  function toVirtual(p) { const r = webRoot(); return p.startsWith(r) ? p.slice(r.length) : p; }
  function virtualPageUrl() { return location.origin + PREFIX + site.token + '/' + encodePath(toVirtual(site.pagePath || '')); }

  const ROOT_GUESSES = ['out', 'dist', 'build', '_site', 'public', 'site', 'www', 'docs', 'html'];
  function detectWebRoot(s) {
    const pages = Array.from(s.entries.keys()).filter(p => PAGE_EXT.test(p));
    if (pages.some(p => /^index\.html?$/i.test(p))) return '';
    for (const c of ROOT_GUESSES) if (pages.some(p => p.toLowerCase() === c + '/index.html')) return c + '/';
    const idx = pages.filter(p => /(^|\/)index\.html?$/i.test(p)).sort((a, b) => depth(a) - depth(b))[0];
    return idx ? idx.replace(/[^/]*$/, '') : '';
  }
  // Folders that could be the site root: the opened folder plus every folder
  // holding an index.html (shallowest first).
  function rootChoices() {
    if (!site) return [];
    const dirs = new Set(['']);
    Array.from(site.entries.keys()).filter(p => /(^|\/)index\.html?$/i.test(p))
      .sort((a, b) => depth(a) - depth(b))
      .forEach(p => { if (dirs.size < 20) dirs.add(p.replace(/[^/]*$/, '')); });
    if (site.webRoot) dirs.add(site.webRoot);
    return Array.from(dirs);
  }
  async function setWebRoot(root) {
    if (!site || root === site.webRoot) return;
    if (!(await confirmLeave('Change the site root?'))) { ES.emit('site-changed'); return; }
    site.webRoot = root;
    const pages = listPages();
    const start = pages.find(p => p === root + 'index.html' || p === root + 'index.htm') || pages[0];
    if (start) await openPage(start, { skipConfirm: true });
    ES.emit('site-changed');
  }

  // Insert our <base> so relative URLs on the canvas resolve into the folder.
  // A page's own relative <base href> is honored by resolving it first.
  function injectBase(html) {
    if (!site) return html;
    html = html.replace(/<base id="__he_base__"[^>]*>/g, '');
    const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
    const headPart = headEnd < 0 ? html : html.slice(0, headEnd);
    const own = /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(headPart);
    const root = PREFIX + site.token + '/';
    let href = location.origin + root + encodePath(toVirtual(pageDir()));
    site.baseDir = null;
    if (own) {
      const val = (own[1] ?? own[2] ?? own[3] ?? '').trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(val) || val.startsWith('//')) return html; // absolute: leave as-is
      try {
        const u = new URL(val, virtualPageUrl());
        let dir;
        if (u.pathname.startsWith(root)) dir = u.pathname.slice(root.length);
        else if (u.pathname.startsWith(PREFIX)) dir = '';          // "../" climbed above the folder
        else dir = u.pathname.slice(1);                           // root-absolute, e.g. href="/"
        dir = dir.replace(/[^/]*$/, '');                          // directory part only
        dir = dir.split('/').map(seg => { try { return decodeURIComponent(seg); } catch (_) { return seg; } }).join('/');
        site.baseDir = webRoot() + dir;
        href = location.origin + root + encodePath(dir);
      } catch (_) {}
    }
    const tag = `<base id="__he_base__" href="${href.replace(/"/g, '&quot;')}">`;
    const m = /<head(\s[^>]*)?>/i.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
    const d = /^\s*<!doctype[^>]*>/i.exec(html);
    if (d) return html.slice(0, d[0].length) + tag + html.slice(d[0].length);
    return tag + html;
  }

  // Folder path -> URL relative to the current page ("../images/a%20b.jpg").
  function relFromPage(sitePath) {
    const from = baseDir().split('/').filter(Boolean);
    const to = sitePath.split('/');
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    return '../'.repeat(from.length - i) + encodePath(to.slice(i).join('/'));
  }

  // URL as written in the page -> folder path, or null if it isn't in the folder.
  function resolveFromPage(url) {
    if (!site || !url) return null;
    url = url.trim();
    if (/^(data|blob|https?|mailto|tel|javascript):/i.test(url) || url.startsWith('//')) return null;
    try {
      const u = new URL(url, 'https://site.invalid/' + encodePath(toVirtual(baseDir())));
      if (u.host !== 'site.invalid') return null;
      return webRoot() + u.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
    } catch (_) { return null; }
  }

  function previewUrl() { return site ? virtualPageUrl() : null; }

  // ---------- Writing assets ----------

  // Folder to copy new images into: an existing image folder if there is one.
  function assetDir() {
    const cands = ['images', 'img', 'assets/images', 'assets/img', 'static/images', 'static/img', 'assets', 'media'];
    const r = webRoot();
    for (const c of cands) {
      const want = (r + c + '/').toLowerCase();
      for (const p of site.entries.keys()) if (p.toLowerCase().startsWith(want)) return p.slice(0, want.length - 1);
    }
    return r + 'images';
  }

  // If the folder already holds this exact file (e.g. dragged in from the
  // site's own images folder in Finder), reuse it instead of copying.
  async function findSame(file) {
    if (!site) return null;
    const base = file.name.toLowerCase();
    const cands = Array.from(site.entries.keys()).filter(p => p.split('/').pop().toLowerCase() === base);
    for (const p of cands) {
      const f = await getFile(p);
      if (!f || f.size !== file.size) continue;
      if (file.size > 25 * 1024 * 1024) return p;
      const [a, b] = await Promise.all([f.arrayBuffer(), file.arrayBuffer()]);
      if (bytesEqual(new Uint8Array(a), new Uint8Array(b))) return p;
    }
    return null;
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Write a new file into the folder. Never overwrites: "photo.jpg" becomes
  // "photo-1.jpg" if the name is taken. Returns the folder path.
  async function writeNewFile(dirPath, fileName, blob) {
    if (!site || site.kind !== 'fsa' || !site.writable) throw new Error('Folder is read-only');
    let dir = site.root;
    for (const seg of dirPath.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(seg, { create: true });
    const safe = sanitizeName(fileName);
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : '';
    let name = safe;
    for (let n = 1; ; n++) {
      let exists = true;
      try { await dir.getFileHandle(name); } catch (_) { exists = false; }
      if (!exists) break;
      name = `${stem}-${n}${ext}`;
      if (n > 999) throw new Error('Too many files named ' + safe);
    }
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    const path = (dirPath ? dirPath.replace(/\/+$/, '') + '/' : '') + name;
    addEntry(site, path, { handle });
    ES.emit('site-changed');
    return path;
  }

  function sanitizeName(n) {
    const cleaned = String(n || 'image').normalize('NFC').replace(/[\/\\:*?"<>|#%\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim();
    return cleaned || 'image';
  }

  // ---------- Remember last folder (Chrome/Edge) ----------

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('html-editor', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveLastFolder(handle) {
    try {
      const db = await idb();
      db.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'lastFolder');
    } catch (_) {}
  }
  async function getLastFolder() {
    try {
      const db = await idb();
      return await new Promise((resolve) => {
        const req = db.transaction('handles').objectStore('handles').get('lastFolder');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }
  async function reopenLast() {
    const h = await getLastFolder();
    if (!h) return false;
    try {
      const perm = await h.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') { toast('Permission to the folder was not granted', 'warn'); return false; }
    } catch (e) { toast('Could not reopen folder: ' + e.message, 'error'); return false; }
    return openFromHandle(h);
  }

  // ---------- misc ----------

  function newToken() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  function showAssetsTab() {
    const tab = document.querySelector('.left-sidebar .tab[data-tab="assets"]');
    if (tab) tab.click();
  }
  function status(msg) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = msg;
  }
  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), type === 'warn' || type === 'error' ? 5000 : 3200);
  }

  return {
    init, active, supportsDirPicker,
    openFolder, openFromHandle, openFromFileList, openFromEntry, openPage, detach, reopenLast, getLastFolder,
    listPages, listImages, rootChoices, setWebRoot, webRoot, getFile, attachResponder, injectBase, checkFrame,
    relFromPage, resolveFromPage, previewUrl, ensureController,
    assetDir, findSame, writeNewFile, IMAGE_EXT,
  };
})();
