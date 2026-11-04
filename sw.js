const CACHE = 'maari-catalog-full-v8';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './logo.jpg',
  './catalog-design.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // لا تخزّن أي طلب خارجي، خصوصاً طلبات Supabase
  if (url.origin !== self.location.origin) return;

  // ملفات التطبيق الأساسية: جرّب الشبكة أولاً
  if (
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/cloud-sync.js') ||
    url.pathname.endsWith('/cloud-config.js') ||
    url.pathname.endsWith('/sw.js') ||
    request.mode === 'navigate'
  ) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached =>
          cached || caches.match('./index.html')
        ))
    );
    return;
  }

  // بقية الملفات الثابتة
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
