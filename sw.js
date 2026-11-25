// Service worker for "site folder" mode.
//
// When you open a site folder, the canvas needs the page's linked files
// (CSS, images, fonts, scripts) to render it the way a browser would. Those
// files live on your disk, not on this server, so this worker intercepts the
// requests and asks the editor tab for the bytes. Nothing is cached here and
// nothing leaves your machine.
//
// Routing (stateless, because the browser kills idle workers):
//   1. Requests under <scope>/__site__/<token>/... (relative URLs on the
//      canvas, which gets a matching <base>, and the new-tab preview) go to
//      the editor window holding <token>.
//   2. Root-absolute requests ("/css/site.css") from a preview tab use that
//      tab's token; from the editing canvas (an about:srcdoc frame) they are
//      handed to the responder the editor installed on that frame, which
//      answers with the file, a 404, or "pass" (no folder open).
//   3. Everything else is the editor itself. Navigations and client-less
//      requests are not intercepted at all; the editor's own subresources are
//      passed straight to the network.
const PREFIX = new URL('__site__/', self.registration.scope).pathname;
const ASK_TIMEOUT_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'he-claim') e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const prefixed = url.pathname.startsWith(PREFIX);
  if (!prefixed && req.mode === 'navigate') {
    // A link like <a href="/about/"> clicked inside the preview tab would
    // otherwise navigate to the editor's own pages. Keep it inside the folder.
    const token = tokenFromUrl(req.referrer);
    if (token) event.respondWith(Response.redirect(PREFIX + token + url.pathname + url.search, 302));
    return;
  }
  // Requests without a client (or from the editor itself) are never routed.
  if (!prefixed && !event.clientId) return;
  event.respondWith(route(event, url, prefixed));
});

function tokenFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    if (!p.startsWith(PREFIX)) return null;
    return p.slice(PREFIX.length).split('/')[0] || null;
  } catch (_) { return null; }
}

async function route(event, url, prefixed) {
  const req = event.request;

  // 1. Folder-addressed requests (canvas relative URLs, the preview tab):
  //    the token in the path says which editor window holds the folder.
  if (prefixed) {
    const rest = url.pathname.slice(PREFIX.length);
    const slash = rest.indexOf('/');
    const token = slash < 0 ? rest : rest.slice(0, slash);
    return fromEditor(token, slash < 0 ? '' : rest.slice(slash + 1));
  }

  // 2. Root-absolute requests ("/css/site.css") need the requesting client.
  let client = null;
  try { client = await self.clients.get(event.clientId); } catch (_) {}
  if (!client) return fetch(req);
  const clientToken = tokenFromUrl(client.url);
  if (clientToken) return fromEditor(clientToken, url.pathname.slice(1));
  if (client.url === 'about:srcdoc') {
    // The editing canvas answers for itself (the editor installed a
    // responder on it). A srcdoc frame with no responder, e.g. an iframe
    // inside the user's page, gets a short wait and then the network.
    const ans = await ask(client, { type: 'he-site-fetch', path: url.pathname }, 1000);
    if (!ans || ans.pass) return fetch(req);
    return toResponse(ans);
  }
  // 3. The editor itself.
  return fetch(req);
}

// Ask editor windows (top-level, not preview tabs) which one has `token`
// open; the first real answer wins.
async function fromEditor(token, sitePath) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const editors = windows.filter(w => w.frameType === 'top-level' && !tokenFromUrl(w.url));
  const ans = await new Promise((resolve) => {
    let pending = editors.length;
    let fallback = null;
    if (!pending) return resolve(null);
    editors.forEach(w => ask(w, { type: 'he-site-fetch', token, sitePath }, ASK_TIMEOUT_MS).then(a => {
      if (a && !a.pass) {
        if (a.status === 200) return resolve(a);
        fallback = fallback || a;
      }
      if (--pending === 0) resolve(fallback);
    }));
  });
  if (ans) return toResponse(ans);
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Folder not open</title>' +
    '<p style="font:15px system-ui;margin:40px">This page belongs to a site folder that is no longer open in the editor. ' +
    'Reopen the folder in the editor tab, then preview again.</p>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function ask(client, msg, timeoutMs) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), timeoutMs);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    try { client.postMessage(msg, [ch.port2]); }
    catch (_) { clearTimeout(t); resolve(null); }
  });
}

function toResponse(ans) {
  const status = ans.status || 200;
  const headers = { 'cache-control': 'no-store' };
  if (ans.type) headers['content-type'] = ans.type;
  if (status !== 200) {
    return new Response(ans.body || 'Not found in site folder', { status, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response(ans.body, { status, headers });
}
