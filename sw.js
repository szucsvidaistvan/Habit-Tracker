// Habit Tracker service worker
// Makes the app itself load offline (app shell + CDN libraries + icons).
// Supabase requests are never cached here - offline.js stores the data instead.

// Bump this whenever you want every device to drop its old cached files.
const CACHE_VERSION = 'v10';
const CACHE_NAME = `habit-tracker-${CACHE_VERSION}`;

// With a cached copy at hand, a page/file request that hangs this long is answered from the cache.
const NETWORK_TIMEOUT_MS = 4000;

// Same-origin files, relative to the service worker's own folder.
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'api.js',
  'offline.js',
  'ui.js',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon.ico',
  'apple-touch-icon.png'
];

// Third-party libraries the page loads with <script src>.
const CDN_LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.0',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://code.iconify.design/3/3.1.0/iconify.min.js'
];

// Hosts that serve icon data at runtime (Iconify fetches icons on demand).
const ICON_HOSTS = ['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com'];

// Download a file fresh (skipping the browser's HTTP cache) and store it.
// CDN files fall back to an "opaque" copy, which is fine for <script src>.
async function precache(cache, url, isCdn) {
  try {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await cache.put(url, response);
  } catch (err) {
    if (!isCdn) throw err;
    const response = await fetch(url, { mode: 'no-cors' });
    await cache.put(url, response);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // One missing file must not break the whole install, so add them one by one.
      await Promise.allSettled([
        ...APP_SHELL.map((url) => precache(cache, url, false)),
        ...CDN_LIBS.map((url) => precache(cache, url, true))
      ]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('habit-tracker-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// Try the network first (so updates show up right away), fall back to the cache.
// If the network hangs (bad wifi) and a cached copy exists, the cached copy wins after a few seconds.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);

  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  network.catch(() => {}); // the failure is handled below; this only avoids an "unhandled rejection" log

  const cached =
    (await cache.match(request, { ignoreSearch: true })) ||
    (fallbackUrl ? await cache.match(fallbackUrl) : undefined);

  if (!cached) return network; // nothing to fall back on - wait for the network

  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch (err) {
    return cached;
  }
}

// Serve from the cache instantly, refresh it in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => undefined);

  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch Supabase (auth + data) - always straight to the network.
  if (url.hostname.endsWith('supabase.co')) return;

  // Page loads: network first, offline fall back to the cached index.html.
  if (request.mode === 'navigate') {
    const fallback = new URL('index.html', self.registration.scope).href;
    event.respondWith(networkFirst(request, fallback));
    return;
  }

  // Our own files.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Libraries and icon data from the CDNs.
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'code.iconify.design') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (ICON_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// ---------- push notifications (habit / task reminders) ----------
// The payload comes from the Supabase "send-reminders" Edge Function, sent as JSON:
// { title, body, tag, url }

self.addEventListener('push', (event) => {
  let payload = { title: 'Habit Tracker', body: 'You have a reminder.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: payload.url || './' }
    })
  );
});

// Tapping the notification focuses an already-open tab if there is one, otherwise opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList.find((c) => c.url === targetUrl) || clientsList[0];
      if (existing) {
        await existing.focus();
      } else {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
