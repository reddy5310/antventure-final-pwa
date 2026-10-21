// Antventure v1 registered this URL as its service worker and answered every
// request cache-first, so returning v1 players would be stuck on v1 forever.
// Browsers re-check a worker's script when its pages load; this replacement
// takes over, drops the v1 caches, unregisters itself and reloads open tabs
// from the network so they boot v2 (which registers sw.js). It has no fetch
// handler on purpose: nothing is served from here any more.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(['antventure-v1', 'antventure-v2'].map((name) => caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
