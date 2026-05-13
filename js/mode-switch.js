// Mode switching: Visual ↔ Source. Owns state.mode and the heuristic
// that picks the initial mode when a file loads.
window.ModeSwitch = (function() {
  const ES = window.EditorState;

  // Always open in Visual mode. The user can toggle to Source via the pill
  // when they want byte-for-byte fidelity.
  function pickInitialMode(_text) {
    return 'visual';
  }

  async function loadIntoInitialMode(text) {
    const mode = pickInitialMode(text);
    await setMode(mode, { skipSync: true });
    if (mode === 'visual') {
      window.Canvas.loadHtml(text);
    } else {
      await window.Source.init();
      window.Source.setContent(text);
    }
    ES.state.sourceHtml = text;
    ES.emit('mode-changed', mode);
  }

  // Switch modes. Carries the working content across the boundary.
  // visual → source: serialize the iframe DOM into the source buffer.
  // source → visual: parse the source buffer into the iframe.
  async function setMode(mode, opts = {}) {
    if (mode === ES.state.mode && !opts.force) return;

    if (!opts.skipSync) {
      if (ES.state.mode === 'visual' && ES.state.doc) {
        // Snapshot current visual DOM into source buffer
        const html = '<!DOCTYPE html>\n' + stripTraces(ES.state.doc.documentElement.outerHTML);
        ES.state.sourceHtml = html;
      } else if (ES.state.mode === 'source' && window.Source) {
        ES.state.sourceHtml = window.Source.getContent();
      }
    }

    ES.state.mode = mode;
    document.body.dataset.mode = mode;
    ES.emit('mode-changed', mode);

    if (!opts.skipSync) {
      if (mode === 'source') {
        await window.Source.init();
        window.Source.setContent(ES.state.sourceHtml);
        setTimeout(() => window.Source.focus(), 50);
      } else {
        window.Canvas.loadHtml(ES.state.sourceHtml);
      }
    }
  }

  function stripTraces(html) {
    return html
      .replace(/<style id="__he_styles__">[\s\S]*?<\/style>/g, '')
      .replace(/\s+contenteditable="[^"]*"/g, '')
      .replace(/\s+data-he-editing="[^"]*"/g, '');
  }

  return { pickInitialMode, loadIntoInitialMode, setMode };
})();
