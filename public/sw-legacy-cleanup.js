// Imported by the generated Workbox worker (sw.js). Players whose v1 worker
// was replaced directly by sw.js still carry the v1 offline caches (the old
// page plus ~3 MB of audio); drop them once v2 is active.
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(['antventure-v1', 'antventure-v2'].map((name) => caches.delete(name))));
});
