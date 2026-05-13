// Git-aware diff: reads the file's content at HEAD via isomorphic-git
// running entirely in the browser, then diffs against the editor's
// current content. User picks the repo root directory once per file;
// the directory handle and relative path are cached on the EditorState.
window.GitDiff = (function() {
  const ES = window.EditorState;
  let git = null;        // isomorphic-git module
  // Per-file cache: { fileHandleKey -> { dirHandle, relPath, branch } }
  const cache = new WeakMap();

  async function ensureLib() {
    if (git) return git;
    // ?bundle ships the buffer/path shims isomorphic-git needs in browsers
    git = await import('https://esm.sh/isomorphic-git@1.27.2?bundle');
    return git;
  }

  async function showDiff() {
    if (!ES.state.fileHandle) {
      toast('Open a file first', 'warn');
      return;
    }
    let info = cache.get(ES.state.fileHandle);
    if (!info) {
      const ok = confirm(
        'To diff against git HEAD, pick the repo root directory in the next picker.\n' +
        '(This stays per-file for the session — no network upload, all parsing happens in your browser.)'
      );
      if (!ok) return;
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        toast('Scanning for file in repo…', '');
        const relPath = await findRelativePath(dirHandle, ES.state.fileHandle);
        if (!relPath) {
          toast('The open file isn\'t inside that directory', 'error');
          return;
        }
        // Verify .git exists
        try { await dirHandle.getDirectoryHandle('.git'); }
        catch { toast('No .git directory found — not a git repo root', 'error'); return; }
        info = { dirHandle, relPath };
        cache.set(ES.state.fileHandle, info);
      } catch (e) {
        if (e.name !== 'AbortError') toast('Could not open directory: ' + e.message, 'error');
        return;
      }
    }

    let headText;
    try {
      toast('Reading HEAD…', '');
      const lib = await ensureLib();
      const fs = fsaAdapter(info.dirHandle);
      const oid = await lib.resolveRef({ fs, dir: '/', ref: 'HEAD' });
      const { blob } = await lib.readBlob({ fs, dir: '/', oid, filepath: info.relPath });
      headText = new TextDecoder().decode(blob);
      info.branch = await currentBranch(lib, fs);
    } catch (e) {
      console.error(e);
      toast('Git read failed: ' + (e.message || e), 'error');
      return;
    }

    const editorText = currentEditorText();
    if (headText === editorText) {
      toast('Editor matches HEAD — no diff', 'success');
      return;
    }
    // Delegate rendering to the disk diff modal, just with different labels
    await window.DiffViewer._renderModal(
      headText,
      editorText,
      `HEAD${info.branch ? ' (' + info.branch + ')' : ''}: ${info.relPath}`,
      'editor',
      { hideApplyButtons: true }
    );
  }

  async function currentBranch(lib, fs) {
    try { return await lib.currentBranch({ fs, dir: '/', fullname: false }); }
    catch { return null; }
  }

  function currentEditorText() {
    if (ES.state.mode === 'source' && window.Source) return window.Source.getContent();
    if (!ES.state.doc) return ES.state.sourceHtml || '';
    return ('<!DOCTYPE html>\n' + ES.state.doc.documentElement.outerHTML)
      .replace(/<style id="__he_styles__">[\s\S]*?<\/style>/g, '')
      .replace(/\s+contenteditable="[^"]*"/g, '')
      .replace(/\s+data-he-editing="[^"]*"/g, '');
  }

  // BFS the directory tree to find a FileSystemFileHandle that's the same
  // entry as our editor's handle. Returns the path-from-root or null.
  // Skips .git and node_modules.
  async function findRelativePath(rootHandle, targetFile) {
    const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache']);
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') {
          try { if (await handle.isSameEntry(targetFile)) return prefix + name; } catch {}
        } else if (handle.kind === 'directory' && !SKIP.has(name)) {
          const found = await walk(handle, prefix + name + '/');
          if (found) return found;
        }
      }
      return null;
    }
    return walk(rootHandle, '');
  }

  // Minimal Node-style fs adapter on top of a FileSystemDirectoryHandle.
  // Only the methods isomorphic-git needs for read operations.
  function fsaAdapter(rootHandle) {
    async function resolve(filepath) {
      const parts = String(filepath).replace(/^\/+/, '').split('/').filter(p => p && p !== '.');
      let handle = rootHandle;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        if (isLast) {
          // Try file first, then directory
          try { return await handle.getFileHandle(part); }
          catch { return await handle.getDirectoryHandle(part); }
        }
        handle = await handle.getDirectoryHandle(part);
      }
      return handle;
    }
    async function readFile(filepath, options) {
      try {
        const h = await resolve(filepath);
        if (h.kind !== 'file') throw enoent(filepath);
        const file = await h.getFile();
        const buf = new Uint8Array(await file.arrayBuffer());
        const enc = options && (options.encoding || options);
        if (enc === 'utf8') return new TextDecoder().decode(buf);
        return buf;
      } catch (e) { throw remap(e, filepath); }
    }
    async function readdir(filepath) {
      try {
        const h = await resolve(filepath || '/');
        if (h.kind !== 'directory') throw enoent(filepath);
        const names = [];
        for await (const [name] of h.entries()) names.push(name);
        return names;
      } catch (e) { throw remap(e, filepath); }
    }
    async function stat(filepath) {
      try {
        const h = await resolve(filepath);
        if (h.kind === 'file') {
          const f = await h.getFile();
          return makeStat(true, f.size, f.lastModified);
        }
        return makeStat(false, 0, 0);
      } catch (e) { throw remap(e, filepath); }
    }
    function makeStat(isFile, size, mtime) {
      const s = {
        isFile: () => isFile,
        isDirectory: () => !isFile,
        isSymbolicLink: () => false,
        size, mode: isFile ? 0o644 : 0o755,
        mtimeMs: mtime, ctimeMs: mtime, ino: 0, uid: 0, gid: 0,
        dev: 0
      };
      s.type = isFile ? 'file' : 'dir';
      return s;
    }
    function enoent(p) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; return e; }
    function remap(e, p) {
      if (e.name === 'NotFoundError' || e.code === 'ENOENT') {
        const x = new Error('ENOENT: ' + p);
        x.code = 'ENOENT';
        return x;
      }
      return e;
    }

    return {
      promises: {
        readFile, readdir, stat,
        lstat: stat,
        readlink: async () => { const e = new Error('ENOTSUP'); e.code = 'ENOTSUP'; throw e; },
        writeFile: async () => { const e = new Error('EROFS'); e.code = 'EROFS'; throw e; },
        unlink: async () => { const e = new Error('EROFS'); e.code = 'EROFS'; throw e; },
        rmdir: async () => { const e = new Error('EROFS'); e.code = 'EROFS'; throw e; },
        mkdir: async () => { const e = new Error('EROFS'); e.code = 'EROFS'; throw e; },
      }
    };
  }

  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  return { showDiff };
})();
