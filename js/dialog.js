// Custom alert / confirm / prompt — Promise-based, themed to match the
// editor, animated, keyboard-friendly (Enter confirms, Esc cancels).
// Replaces the ugly native dialogs.
window.Dialog = (function() {

  function ensureHost() {
    let host = document.getElementById('dialog-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dialog-host';
      document.body.appendChild(host);
    }
    return host;
  }

  function open(opts) {
    return new Promise((resolve) => {
      const host = ensureHost();

      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      const panel = document.createElement('div');
      panel.className = 'dialog-panel' + (opts.danger ? ' danger' : '');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');

      const icon = opts.icon || (opts.kind === 'prompt' ? 'pencil-line' :
                                  opts.danger ? 'triangle-alert' :
                                  opts.kind === 'confirm' ? 'circle-help' : 'info');

      panel.innerHTML = `
        <div class="dialog-head">
          <div class="dialog-icon"><i data-lucide="${icon}"></i></div>
          <div class="dialog-titles">
            ${opts.title ? `<h3 class="dialog-title"></h3>` : ''}
            ${opts.message ? `<p class="dialog-message"></p>` : ''}
          </div>
        </div>
        ${opts.kind === 'prompt' ? `
          <div class="dialog-body">
            <input type="text" class="dialog-input" placeholder="${escapeAttr(opts.placeholder || '')}" />
          </div>` : ''}
        <div class="dialog-actions">
          ${opts.kind !== 'alert' ? `<button class="dialog-btn dialog-btn-secondary" data-act="cancel">${escapeHtml(opts.cancelLabel || 'Cancel')}</button>` : ''}
          <button class="dialog-btn dialog-btn-primary${opts.danger ? ' danger' : ''}" data-act="confirm">${escapeHtml(opts.confirmLabel || (opts.kind === 'alert' ? 'OK' : 'Confirm'))}</button>
        </div>
      `;
      if (opts.title) panel.querySelector('.dialog-title').textContent = opts.title;
      if (opts.message) panel.querySelector('.dialog-message').textContent = opts.message;

      overlay.appendChild(panel);
      host.appendChild(overlay);

      const input = panel.querySelector('.dialog-input');
      if (input) {
        input.value = opts.defaultValue || '';
        setTimeout(() => { input.focus(); input.select(); }, 30);
      } else {
        setTimeout(() => panel.querySelector('[data-act="confirm"]').focus(), 30);
      }

      let resolved = false;
      function finish(value) {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 140);
        resolve(value);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(opts.kind === 'prompt' ? null : false);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          // Enter from input or anywhere in dialog confirms
          if (e.target.closest('.dialog-panel')) {
            e.preventDefault();
            doConfirm();
          }
        }
      }
      document.addEventListener('keydown', onKey, true);

      function doConfirm() {
        if (opts.kind === 'prompt') {
          finish(input ? input.value : '');
        } else if (opts.kind === 'alert') {
          finish();
        } else {
          finish(true);
        }
      }
      function doCancel() {
        finish(opts.kind === 'prompt' ? null : false);
      }

      panel.querySelector('[data-act="confirm"]').addEventListener('click', doConfirm);
      const cancelBtn = panel.querySelector('[data-act="cancel"]');
      if (cancelBtn) cancelBtn.addEventListener('click', doCancel);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) doCancel();
      });

      if (window.renderIcons) window.renderIcons();
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  return {
    alert(opts)   { return open({ ...(typeof opts === 'string' ? { message: opts } : opts), kind: 'alert' }); },
    confirm(opts) { return open({ ...(typeof opts === 'string' ? { message: opts } : opts), kind: 'confirm' }); },
    prompt(opts)  { return open({ ...(typeof opts === 'string' ? { message: opts } : opts), kind: 'prompt' }); },
  };
})();
