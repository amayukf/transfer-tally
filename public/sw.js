const CACHE_NAME = 'transfer-tally-v2';
const STATIC_ASSETS = ['/', '/manifest.json', '/icon.svg'];

// Web Share Target hand-off: the OS POSTs shared screenshots to /share-target,
// this worker parks them in a dedicated cache and redirects the app to /?shared=1
// so the page can pick them up and start scanning.
const SHARE_CACHE = 'transfer-tally-shared';
const SHARE_TARGET_PATH = '/share-target';
const SHARED_COUNT_KEY = '/__shared_count';
const sharedFileKey = (index) => `/__shared_${index}`;

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const received = formData.getAll('images');
    const files = received.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.arrayBuffer === 'function' &&
        item.size > 0
    );

    const cache = await caches.open(SHARE_CACHE);
    // Drop anything left over from a previous, unconsumed share.
    const staleKeys = await cache.keys();
    await Promise.all(staleKeys.map((key) => cache.delete(key)));

    await cache.put(
      new Request(SHARED_COUNT_KEY),
      new Response(String(files.length), {
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    for (let i = 0; i < files.length; i++) {
      await cache.put(
        new Request(sharedFileKey(i)),
        new Response(files[i], {
          headers: {
            'Content-Type': files[i].type || 'application/octet-stream',
          },
        })
      );
    }

    return Response.redirect('/?shared=1', 303);
  } catch {
    return Response.redirect('/?shared=error', 303);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== SHARE_CACHE) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  let requestUrl;
  try {
    requestUrl = new URL(event.request.url);
  } catch {
    return;
  }

  // Web Share Target: shared screenshots arrive as a POST to /share-target.
  if (event.request.method === 'POST' && requestUrl.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Only process GET requests from here on
  if (event.request.method !== 'GET') {
    return;
  }

  // Ignore non-http(s) schemes (e.g. blob:, data:, chrome-extension:)
  if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
    return;
  }

  // Bypass API routes completely
  if (requestUrl.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first strategy with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache valid basic or opaque responses
        if (
          response &&
          (response.type === 'basic' || response.type === 'opaque') &&
          response.status === 200
        ) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }
          // Fallback to cached root shell for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return undefined;
        });
      })
  );
});
