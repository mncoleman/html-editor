// File operations: File System Access API, import/export, drag-drop on page
window.FileOps = (function() {
  const ES = window.EditorState;
  const hasFSA = 'showOpenFilePicker' in window;
  const isSecure = window.isSecureContext;
  const supportsFSA = hasFSA && isSecure;
  // mtime of the on-disk file the last time we read or wrote it. Used to
  // detect external modifications when the editor regains focus.
  let lastKnownMtime = null;
  let externalChangePending = false;

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
      lastKnownMtime = file.lastModified;
      clearExternalChange();
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
  // - Visual mode (clean): the user hasn't edited anything since load,
  //   so return the original source string verbatim.
  // - Visual mode (dirty): serialize the iframe DOM, then re-encode
  //   characters back to whichever entities the original source used
  //   (`—` → `&mdash;` if the source had `&mdash;`). This kills the
  //   widespread entity-normalization noise that otherwise touches
  //   every line containing a special character.
  function currentHtml() {
    if (ES.state.mode === 'source' && window.Source) {
      return window.Source.getContent();
    }
    if (!ES.state.doc) return ES.state.sourceHtml || '';
    if (!ES.state.dirty && ES.state.sourceHtml) return ES.state.sourceHtml;
    let serialized = stripEditorTraces('<!DOCTYPE html>\n' + ES.state.doc.documentElement.outerHTML);
    if (ES.state.sourceHtml) {
      serialized = reEncodeEntities(serialized, ES.state.sourceHtml);
      // Splice the user's edit back into the original source so untouched
      // regions stay byte-identical (preserves doctype casing, original
      // whitespace, and avoids implicit <tbody> showing up as a diff).
      const spliced = spliceEditIntoSource(serialized, ES.state.sourceHtml);
      if (spliced !== null) serialized = spliced;
    }
    return serialized;
  }

  // Reduce the serialized-edited HTML back to (original source) + (just the
  // user's edit). Returns null if we can't confidently align — caller falls
  // back to the full serialization.
  function spliceEditIntoSource(curNorm, sourceHtml) {
    // Re-parse the source the same way the editor parsed it on load. The
    // result's outerHTML form is the "normalized" view that curNorm is
    // expressed in — so the diff between origNorm and curNorm is purely
    // the user's edit, with no normalization noise.
    let origDoc;
    try { origDoc = new DOMParser().parseFromString(sourceHtml, 'text/html'); }
    catch (_) { return null; }
    if (!origDoc || !origDoc.documentElement) return null;
    const origNorm = stripEditorTraces('<!DOCTYPE html>\n' + origDoc.documentElement.outerHTML);

    if (origNorm === curNorm) return sourceHtml;

    // Find common prefix and suffix (in normalized space).
    const maxPrefix = Math.min(origNorm.length, curNorm.length);
    let P = 0;
    while (P < maxPrefix && origNorm.charCodeAt(P) === curNorm.charCodeAt(P)) P++;
    const maxSuffix = Math.min(origNorm.length - P, curNorm.length - P);
    let S = 0;
    while (
      S < maxSuffix &&
      origNorm.charCodeAt(origNorm.length - 1 - S) === curNorm.charCodeAt(curNorm.length - 1 - S)
    ) S++;

    // Map P (end of unchanged prefix in normalized) and origNorm.length - S
    // (start of unchanged suffix in normalized) into source coordinates.
    const sP = mapNormToSource(P, origNorm, sourceHtml);
    if (sP < 0) return null;
    const sQ = mapNormToSource(origNorm.length - S, origNorm, sourceHtml);
    if (sQ < 0) return null;

    return sourceHtml.slice(0, sP) + curNorm.slice(P, curNorm.length - S) + sourceHtml.slice(sQ);
  }

  // Walk `norm` and `source` in lockstep, tolerating the specific
  // differences a DOMParser+outerHTML round-trip can introduce, and return
  // the source position corresponding to position `targetNormPos` in norm.
  // Tolerated differences:
  //   - <!DOCTYPE html> casing (and the whitespace between doctype and <html>)
  //   - any run of whitespace between tags can differ in both amount and kind
  //   - implicit <tbody>/</tbody> tags that the parser inserts where missing
  //   - attribute reordering on the same opening tag
  function mapNormToSource(targetNormPos, norm, source) {
    let n = 0, s = 0;
    const isWS = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

    while (n < targetNormPos) {
      if (n < norm.length && s < source.length && norm.charCodeAt(n) === source.charCodeAt(s)) {
        n++; s++; continue;
      }

      // Whitespace divergence: skip whitespace on whichever side has it
      // (we re-converge on the next non-ws char). This handles <html>\n\t<head>
      // ↔ <html><head>, </body>\n</html> ↔ </body></html>, and similar.
      let advanced = false;
      while (n < norm.length && isWS(norm[n]) && n < targetNormPos) { n++; advanced = true; }
      while (s < source.length && isWS(source[s])) { s++; advanced = true; }
      if (advanced) continue;

      // Doctype case difference: <!doctype html> vs <!DOCTYPE html>
      if (matchCI(norm, n, '<!doctype') && matchCI(source, s, '<!doctype')) {
        // Advance past the doctype declaration in both, up to and
        // including the '>'.
        const ne = norm.indexOf('>', n);
        const se = source.indexOf('>', s);
        if (ne < 0 || se < 0) return -1;
        if (n + (ne - n + 1) > targetNormPos) {
          // The target falls inside the doctype — clamp to start of doctype
          // in source so we don't split it mid-token.
          return s;
        }
        n = ne + 1; s = se + 1;
        continue;
      }

      // Implicit <tbody>/</tbody> only present on the normalized side.
      if (matchCI(norm, n, '<tbody>')) { n += '<tbody>'.length; continue; }
      if (matchCI(norm, n, '</tbody>')) { n += '</tbody>'.length; continue; }
      // (Defensive — shouldn't happen, but mirror for the source side)
      if (matchCI(source, s, '<tbody>')) { s += '<tbody>'.length; continue; }
      if (matchCI(source, s, '</tbody>')) { s += '</tbody>'.length; continue; }

      // Attribute reordering / quoting differences on the same opening tag.
      // If both sides are sitting at '<' and the tag name matches, skip to
      // the matching '>' on each side. Inside-attr quoting differences are
      // not the user's edit; we just have to keep alignment.
      if (norm[n] === '<' && source[s] === '<') {
        const ne = norm.indexOf('>', n);
        const se = source.indexOf('>', s);
        if (ne > n && se > s) {
          const nTag = norm.slice(n + 1, ne).split(/[\s/>]/)[0].toLowerCase();
          const sTag = source.slice(s + 1, se).split(/[\s/>]/)[0].toLowerCase();
          if (nTag && nTag === sTag) {
            if (ne + 1 > targetNormPos) return s; // target inside this tag — anchor at tag start
            n = ne + 1; s = se + 1;
            continue;
          }
        }
      }

      // Unknown divergence — bail out.
      return -1;
    }
    return s;
  }

  function matchCI(str, pos, needle) {
    if (pos + needle.length > str.length) return false;
    for (let i = 0; i < needle.length; i++) {
      const a = str.charCodeAt(pos + i);
      const b = needle.charCodeAt(i);
      if (a === b) continue;
      // ASCII case-insensitive
      if (a >= 65 && a <= 90 && a + 32 === b) continue;
      if (a >= 97 && a <= 122 && a - 32 === b) continue;
      return false;
    }
    return true;
  }

  // Cache: keyed by sourceHtml reference, value is the unicode→entity map
  // derived from it. Building the map is cheap (~one regex pass), but the
  // cache means a save + immediate diff doesn't repeat the work.
  let entityMapCache = { src: null, map: null };
  function buildEntityMap(sourceHtml) {
    if (entityMapCache.src === sourceHtml) return entityMapCache.map;
    const map = new Map();
    // Match named, decimal, and hex entities. Ignore the ones that
    // outerHTML always emits as entities (amp, lt, gt, quot, apos) so we
    // don't try to "preserve" e.g. &lt; — it stays &lt; on serialize
    // anyway.
    const ALWAYS_ESCAPED = new Set(['&amp;', '&lt;', '&gt;', '&quot;', '&apos;']);
    const re = /&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
    const decoder = document.createElement('div');
    let m;
    while ((m = re.exec(sourceHtml)) !== null) {
      const entity = m[0];
      if (ALWAYS_ESCAPED.has(entity)) continue;
      decoder.innerHTML = entity;
      const ch = decoder.textContent;
      // Only useful if the entity actually decoded to something different
      // (e.g. an unknown entity stays literal) and we don't already have
      // a mapping for this char.
      if (ch && ch !== entity && !map.has(ch)) map.set(ch, entity);
    }
    entityMapCache = { src: sourceHtml, map };
    return map;
  }

  function reEncodeEntities(html, sourceHtml) {
    const map = buildEntityMap(sourceHtml);
    if (map.size === 0) return html;
    const escaped = Array.from(map.keys())
      .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const re = new RegExp('(' + escaped + ')', 'g');
    return html.replace(re, (_, ch) => map.get(ch));
  }

  async function save() {
    const html = currentHtml();
    if (!html) return;
    if (ES.state.fileHandle) {
      try {
        // Pre-write conflict check: if the on-disk mtime is newer than
        // the last time we read or wrote, an external edit happened
        // since the editor last synced. Confirm before clobbering.
        try {
          const pre = await ES.state.fileHandle.getFile();
          if (lastKnownMtime != null && pre.lastModified > lastKnownMtime) {
            const overwrite = await window.Dialog.confirm({
              title: 'File changed on disk',
              message:
                'Someone (or something) modified this file since you last read it. ' +
                'Saving now will overwrite those external changes.\n\n' +
                'Overwrite anyway, or cancel and use ↻ Refresh to see the disk version first?',
              confirmLabel: 'Overwrite disk',
              cancelLabel: 'Cancel',
              danger: true,
            });
            if (!overwrite) {
              markExternalChange();
              const s = document.getElementById('save-status');
              s.dataset.state = 'dirty';
              s.textContent = '● Unsaved';
              return;
            }
          }
        } catch (_) { /* fall through to write; the write itself will surface real errors */ }

        const status = document.getElementById('save-status');
        status.dataset.state = 'saving';
        status.textContent = 'Saving…';
        await writeWithPermissionRecovery(ES.state.fileHandle, html);
        ES.state.sourceHtml = html;
        ES.setDirty(false);
        // Refresh our mtime so the next external check doesn't fire on
        // the write we just performed.
        try { const f = await ES.state.fileHandle.getFile(); lastKnownMtime = f.lastModified; } catch (_) {}
        clearExternalChange();
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

  // Write through the FSA handle. If the browser denies writes
  // (NotAllowedError / SecurityError — typically because the user
  // revoked permission via the page-info menu mid-session), re-request
  // permission and retry once. Surface a clear error if they deny.
  async function writeWithPermissionRecovery(handle, html) {
    try {
      const writable = await handle.createWritable();
      await writable.write(html);
      await writable.close();
      return;
    } catch (e) {
      const isPermission =
        e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'
          || (typeof e.message === 'string' && /permission|not allowed/i.test(e.message)));
      if (!isPermission || typeof handle.requestPermission !== 'function') throw e;

      const granted = await handle.requestPermission({ mode: 'readwrite' });
      if (granted !== 'granted') {
        const err = new Error('Write permission denied — re-grant access via the page-info icon in the address bar');
        err.cause = e;
        throw err;
      }
      const writable = await handle.createWritable();
      await writable.write(html);
      await writable.close();
    }
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

  // Re-read the file from disk and load it into the editor. Used by the
  // refresh button and the focus-based external-change detector.
  async function reloadFromDisk(opts = {}) {
    if (!ES.state.fileHandle) {
      toast('No linked file — open one with "Open Local File" first', 'warn');
      return false;
    }
    try {
      const file = await ES.state.fileHandle.getFile();
      const text = await file.text();
      lastKnownMtime = file.lastModified;

      if (text === ES.state.sourceHtml) {
        if (!opts.silent) toast('Already up to date', '');
        clearExternalChange();
        return false;
      }

      if (ES.state.dirty && !opts.force) {
        const ok = await window.Dialog.confirm({
          title: 'File changed on disk',
          message: 'You have unsaved changes in the editor. Reload from disk and discard them?',
          confirmLabel: 'Discard & reload',
          cancelLabel: 'Keep my changes',
          danger: true,
        });
        if (!ok) return false;
      }

      ES.state.sourceHtml = text;
      if (ES.state.mode === 'source' && window.Source) {
        window.Source.setContent(text);
      } else {
        window.Canvas.loadHtml(text);
      }
      ES.setDirty(false);
      clearExternalChange();
      toast('Reloaded from disk', 'success');
      return true;
    } catch (e) {
      toast('Reload failed: ' + e.message, 'error');
      return false;
    }
  }

  // Cheap mtime poll — runs when the window regains focus / becomes
  // visible. If disk-mtime > our last known mtime, mark the refresh
  // button as having a pending update.
  async function checkExternalChanges() {
    if (!ES.state.fileHandle || lastKnownMtime == null) return;
    try {
      const file = await ES.state.fileHandle.getFile();
      if (file.lastModified > lastKnownMtime) markExternalChange();
    } catch (_) { /* permission may have been revoked */ }
  }

  function markExternalChange() {
    if (externalChangePending) return;
    externalChangePending = true;
    const btn = document.getElementById('tb-refresh');
    if (btn) {
      btn.classList.add('has-update');
      btn.title = 'File changed on disk — click to reload';
    }
    toast('File changed on disk — click ↻ to reload', 'warn');
  }
  function clearExternalChange() {
    externalChangePending = false;
    const btn = document.getElementById('tb-refresh');
    if (btn) {
      btn.classList.remove('has-update');
      btn.title = 'Refresh from disk — pull in external changes';
    }
  }

  // Wire up focus / visibility listeners
  window.addEventListener('focus', () => checkExternalChanges());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkExternalChanges();
  });

  // Keep refresh / diff button enabled state in sync with whether we have a handle
  ES.on((evt) => {
    if (evt === 'file-changed') {
      const hasHandle = !!ES.state.fileHandle;
      ['tb-refresh', 'tb-diff', 'tb-git-diff'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !hasHandle;
      });
    }
  });

  return { init, openLocalFile, promptImport, importFile, save, exportFile, newBlank, reloadFromDisk, checkExternalChanges, currentHtml, supportsFSA };
})();
