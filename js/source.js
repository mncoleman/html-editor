// Source mode — CodeMirror 6 textual editor. Edits the file as a string,
// byte-for-byte, with no parse/serialize round trip.
window.Source = (function() {
  const ES = window.EditorState;
  let view = null;
  let host = null;
  let initPromise = null;
  // Cached references to CodeMirror module exports we need beyond init,
  // notably EditorState for resetting history on mode switches.
  let cmModules = null;

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      host = document.getElementById('source-pane');
      try {
        const cm = await import('codemirror');
        const lang = await import('@codemirror/lang-html');
        const dark = await import('@codemirror/theme-one-dark');
        const state = await import('@codemirror/state');
        const cmview = await import('@codemirror/view');
        cmModules = { cm, lang, dark, state, cmview };

        view = new cm.EditorView({
          state: buildEditorState(ES.state.sourceHtml || ''),
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

  // Build a fresh EditorState. Used both at init and on mode switches
  // into Source — switching modes resets history so an inadvertent Cmd+Z
  // can't roll back to a pre-mode-switch (visual-mode) state that the
  // CodeMirror buffer never saw.
  function buildEditorState(doc) {
    if (!cmModules) return null;
    const { cm, lang, dark, cmview } = cmModules;
    return cm.EditorState.create({
      doc,
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
    });
  }

  function setContent(text) {
    if (!view) return;
    if (view._fallback) { view._fallback.value = text || ''; return; }
    // Replace the entire EditorState (and therefore the history field)
    // rather than dispatching changes — see buildEditorState comment.
    if (cmModules) view.setState(buildEditorState(text || ''));
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
