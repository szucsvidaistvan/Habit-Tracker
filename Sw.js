// Habit Tracker service worker
// Step 1: make the app itself load offline (app shell + CDN libraries + icons).
// Data (Supabase) is deliberately NOT cached here - that comes in the next step.

// Bump this whenever you want every device to drop its old cached files.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `habit-tracker-${CACHE_VERSION}`;

// Same-origin files, relative to the service worker's own folder.
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'api.js',
  'ui.js',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'favicon-16x16.png',
  'favicon-32x32.png'
];

// Third-party libraries the page loads with <script src>.
const CDN_LIBS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.0',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://code.iconify.design/3/3.1.0/iconify.min.js'
];

// Hosts that serve icon data at runtime (Iconify fetches icons on demand).
const ICON_HOSTS = ['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // One missing file must not break the whole install, so add them one by one.
      await Promise.allSettled([...APP_SHELL, ...CDN_LIBS].map((url) => cache.add(url)));
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
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (fallbackUrl ? await cache.match(fallbackUrl) : undefined);
    if (cached) return cached;
    throw err;
  }
}

// Serve from the cache instantly, refresh it in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
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
