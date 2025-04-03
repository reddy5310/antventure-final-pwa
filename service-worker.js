const cacheName = "antventure-v2";
const filesToCache = [
  "./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "./audio/bgm.mp3", "./audio/rain.mp3", "./assets/ant.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(cacheName).then(cache => cache.addAll(filesToCache)));
});
self.addEventListener("fetch", e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
