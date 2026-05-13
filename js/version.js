// Version chip — loads /version.json (written by the Pages deploy workflow)
// and shows the deployed short SHA + build time. Links to the commit on GitHub.
(function() {
  const REPO = 'mncoleman/html-editor';

  async function init() {
    try {
      const res = await fetch('version.json', { cache: 'no-store' });
      if (!res.ok) return; // local dev or build-info missing — chip stays hidden
      const v = await res.json();
      render(v);
    } catch (e) {
      // Network/parse error — silently skip
    }
  }

  function render(v) {
    if (!v || !v.short) return;
    const built = v.built_at ? formatAge(v.built_at) : '';
    const text = built ? `${v.short} · ${built}` : v.short;
    const href = `https://github.com/${REPO}/commit/${v.sha || v.short}`;
    const title = [
      `commit: ${v.sha || v.short}`,
      v.ref ? `branch: ${v.ref}` : null,
      v.built_at ? `built: ${v.built_at}` : null,
    ].filter(Boolean).join('\n');

    ['version-chip', 'empty-version-chip'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.href = href;
      el.title = title;
      const txt = el.querySelector('.version-text');
      if (txt) txt.textContent = text;
      el.hidden = false;
    });
  }

  function formatAge(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toISOString().slice(0, 10);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
