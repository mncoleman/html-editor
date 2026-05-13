// Source mode — CodeMirror 6 textual editor. Edits the file as a string,
// byte-for-byte, with no parse/serialize round trip.
window.Source = (function() {
  const ES = window.EditorState;
  let view = null;
  let host = null;
  let initPromise = null;

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      host = document.getElementById('source-pane');
      try {
        const cm = await import('https://esm.sh/codemirror@6.0.1');
        const lang = await import('https://esm.sh/@codemirror/lang-html@6.4.9');
        const dark = await import('https://esm.sh/@codemirror/theme-one-dark@6.1.2');
        const state = await import('https://esm.sh/@codemirror/state@6.4.1');
        const cmview = await import('https://esm.sh/@codemirror/view@6.26.3');

        view = new cm.EditorView({
          doc: ES.state.sourceHtml || '',
          extensions: [
            cm.basicSetup,
            lang.html(),
            ES.state.theme === 'dark' ? dark.oneDark : [],
            cmview.EditorView.theme({
              '&': { height: '100%', fontSize: '13px' },
              '.cm-scroller': { fontFamily: 'var(--mono)' },
              '.cm-content': { padding: '12px 0' },
              '.cm-gutters': { background: 'var(--bg-2)', borderRight: '1px solid var(--border)' },
              '.cm-activeLineGutter, .cm-activeLine': { background: 'var(--accent-soft)' },
            }),
            cmview.EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              ES.state.sourceHtml = view.state.doc.toString();
              ES.setDirty(true);
              ES.scheduleAutosave();
            }),
          ],
          parent: host,
        });
        host.dataset.ready = 'true';
      } catch (e) {
        console.error('CodeMirror failed to load, falling back to textarea', e);
        // Fallback: simple textarea
        host.innerHTML = '';
        const ta = document.createElement('textarea');
        ta.className = 'source-fallback';
        ta.value = ES.state.sourceHtml || '';
        ta.spellcheck = false;
        ta.addEventListener('input', () => {
          ES.state.sourceHtml = ta.value;
          ES.setDirty(true);
          ES.scheduleAutosave();
        });
        host.appendChild(ta);
        view = { _fallback: ta };
        host.dataset.ready = 'fallback';
      }
    })();
    return initPromise;
  }

  function setContent(text) {
    if (!view) return;
    if (view._fallback) { view._fallback.value = text || ''; return; }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text || '' }
    });
  }

  function getContent() {
    if (!view) return ES.state.sourceHtml || '';
    if (view._fallback) return view._fallback.value;
    return view.state.doc.toString();
  }

  function focus() {
    if (!view) return;
    if (view._fallback) { view._fallback.focus(); return; }
    view.focus();
  }

  return { init, setContent, getContent, focus };
})();
