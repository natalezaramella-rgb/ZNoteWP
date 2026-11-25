/* Service worker di ZNoteKeeper. ZNK (versione, guscio, risorse) è definito sopra dal plugin.
 * - Guscio e risorse dell'app in cache: l'app si apre anche senza rete.
 * - Le chiamate all'API non passano mai dalla cache (i dati offline stanno, cifrati, in IndexedDB).
 * - Le notifiche push sono senza contenuto: il sito non conosce i titoli delle attività. */
const CACHE = 'znk-' + ZNK.version;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll([ZNK.shell, ...ZNK.assets].map(u => new Request(u, { cache: 'reload', credentials: 'omit' })));
    // Le copie appena scaricate vengono comunque controllate a ogni uso (vedi trusted()).
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('znk-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Impronte SHA-256 calcolate dal plugin (per percorso). Una copia in cache con impronta
// diversa (per esempio scritta da uno script di un'altra pagina del sito) viene scartata.
async function digest(res) {
  const buf = await res.clone().arrayBuffer();
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (const x of h) s += String.fromCharCode(x);
  return btoa(s);
}
async function trusted(res, expected) {
  if (!res || !expected) return false;
  try { return (await digest(res)) === expected; } catch (err) { return false; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/wp-json/') || url.searchParams.has('rest_route')) return;
  const shell = new URL(ZNK.shell);
  const isShell = req.mode === 'navigate' && url.pathname === shell.pathname && (url.search === '' || url.searchParams.has('do') || url.searchParams.get('znk') === 'app');
  if (isShell) {
    // Rete prima (per avere sempre l'ultima versione), poi cache se offline.
    e.respondWith((async () => {
      try {
        const r = await fetch(req, { cache: 'no-store' });
        if (r.ok && await trusted(r, ZNK.shell_hash)) { const c = await caches.open(CACHE); c.put(ZNK.shell, r.clone()); }
        return r;
      } catch (err) {
        const hit = await caches.match(ZNK.shell);
        return (await trusted(hit, ZNK.shell_hash)) ? hit : Response.error();
      }
    })());
    return;
  }
  if (ZNK.assets.includes(url.href) || url.pathname.includes('/znotekeeper/app/')) {
    const expected = ZNK.hashes[url.pathname];
    e.respondWith((async () => {
      const hit = (await caches.match(req, { ignoreVary: true })) || (await caches.match(req, { ignoreVary: true, ignoreSearch: true }));
      if (hit && await trusted(hit, expected)) return hit;
      const r = await fetch(req);
      if (r.ok && expected && url.searchParams.get('v') === ZNK.version && await trusted(r, expected)) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
      return r;
    })());
  }
});

self.addEventListener('push', e => {
  e.waitUntil(self.registration.showNotification('ZNoteKeeper', {
    body: 'Hai un\'attività in scadenza.',
    icon: ZNK.icon,
    badge: ZNK.icon,
    tag: 'znk-due',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.startsWith(ZNK.shell.split('?')[0])) { await c.focus(); return; }
    await self.clients.openWindow(ZNK.shell);
  })());
});
