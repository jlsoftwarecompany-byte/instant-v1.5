// Bump VERSION on every deploy-meaningful change to force old caches to purge.
const VERSION = 'v2-2026-05-30';
const CACHE_NAME = `instant-${VERSION}`;

// Only cache truly static, path-stable shell extras for offline use.
// IMPORTANT: index.html is NOT pre-cached as a primary source — it is served
// network-first so users always receive the latest build (with current asset
// hashes). Caching index.html cache-first was the cause of stale loads and
// blank-screen failures (old HTML referencing deleted hashed bundles -> 404).
const SHELL_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: warm the offline shell, activate immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {}) // missing optional asset must not block install
  );
  self.skipWaiting();
});

// Activate: delete every cache that isn't the current version, then take control.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept API / WebSocket traffic.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  const isNavigation =
    event.request.mode === 'navigate' || event.request.destination === 'document';

  // ── HTML / navigation: NETWORK-FIRST ─────────────────────────────────────
  // Always try the network so the freshest index.html (pointing at the current
  // asset hashes) is delivered. Fall back to cache only when offline.
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put('/index.html', clone))
            .catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || caches.match(event.request))
        )
    );
    return;
  }

  // ── Content-hashed static assets: CACHE-FIRST (safe — filename changes on edit)
  if (
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|woff2?|png|svg|ico|jpg|jpeg|gif|webp)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone))
              .catch(() => {});
          }
          return response;
        })
      )
    );
    return;
  }

  // Everything else: straight to network (no caching).
});

self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Instant Notification';
    const options = {
      body: data.body || 'You have a new action waiting in Instant.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.data || {},
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('Failed to parse push notification package payload:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = new URL(self.location.origin);
  if (event.notification.data && event.notification.data.conversationId) {
    urlToOpen.searchParams.set('chat', event.notification.data.conversationId);
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen.href && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen.href);
      }
    })
  );
});
