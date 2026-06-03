// Source mode — CodeMirror 6 textual editor. Edits the file as a string,
// byte-for-byte, with no parse/serialize round trip.
window.Source = (function() {
  const ES = window.EditorState;
  let view = null;
  let host = null;
  let initPromise = null;
  // Cached references to the CodeMirror module exports we need beyond init.
  let cmModules = null;
  // The EditorState class captured from the live view at init. We can't import
  // it separately (that loads a second core instance — see init), so we grab
  // the one the view already uses for history-resetting state swaps.
  let EditorStateCtor = null;

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      host = document.getElementById('source-pane');
      try {
        // Import everything from the single `codemirror` meta-package. Pulling
        // @codemirror/state or @codemirror/view in separately loads a *second*
        // copy of the core library off the CDN; the resulting cross-instance
        // extensions then fail CodeMirror's internal instanceof checks
        // ("Unrecognized extension value… multiple instances of
        // @codemirror/state"), which silently dropped us to the textarea.
        const cm = await import('codemirror');
        const lang = await import('@codemirror/lang-html');
        const dark = await import('@codemirror/theme-one-dark');
        cmModules = { cm, lang, dark };

        // Let the EditorView constructor build the initial state with its own
        // bundled EditorState, then capture that class for later resets.
        view = new cm.EditorView({
          doc: ES.state.sourceHtml || '',
          extensions: buildExtensions(),
          parent: host,
        });
        EditorStateCtor = view.state.constructor;
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

  // Build the extension set. Used both at init and on mode switches into
  // Source — recreating the state on switch resets history so an inadvertent
  // Cmd+Z can't roll back to a pre-mode-switch (visual-mode) state that the
  // CodeMirror buffer never saw. Every extension is sourced from the single
  // `codemirror` instance (incl. EditorView.theme/updateListener statics).
  function buildExtensions() {
    if (!cmModules) return [];
    const { cm, lang, dark } = cmModules;
    return [
      cm.basicSetup,
      lang.html(),
      ES.state.theme === 'dark' ? dark.oneDark : [],
      cm.EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: 'var(--mono)' },
        '.cm-content': { padding: '12px 0' },
        '.cm-gutters': { background: 'var(--bg-2)', borderRight: '1px solid var(--border)' },
        '.cm-activeLineGutter, .cm-activeLine': { background: 'var(--accent-soft)' },
      }),
      cm.EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        ES.state.sourceHtml = view.state.doc.toString();
        ES.setDirty(true);
        ES.scheduleAutosave();
      }),
    ];
  }

  function setContent(text) {
    if (!view) return;
    if (view._fallback) { view._fallback.value = text || ''; return; }
    // Replace the entire EditorState (and therefore the history field)
    // rather than dispatching changes — see buildExtensions comment. Uses the
    // EditorState class captured from the view so instances stay consistent.
    if (EditorStateCtor) view.setState(EditorStateCtor.create({ doc: text || '', extensions: buildExtensions() }));
    else view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text || '' } });
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
