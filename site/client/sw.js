const CACHE = 'seek-v1'
const SHELL = ['/', '/game.js', '/style.css', '/manifest.json']

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)))
)

self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
)

self.addEventListener('fetch', e => {
  // Network-first for API, cache-first for shell
  if (e.request.url.includes('/api/')) return
  e.respondWith(caches.match(e.request).then(r => r ?? fetch(e.request)))
})