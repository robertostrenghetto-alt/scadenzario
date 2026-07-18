const CACHE_NAME = "scadenzario-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./assets/zxing.min.js",
  "./assets/supabase.min.js",
  "./assets/fonts/fraunces-latin-500-normal.woff2",
  "./assets/fonts/fraunces-latin-600-normal.woff2",
  "./assets/fonts/fraunces-latin-700-normal.woff2",
  "./assets/fonts/dm-sans-latin-400-normal.woff2",
  "./assets/fonts/dm-sans-latin-500-normal.woff2",
  "./assets/fonts/dm-sans-latin-700-normal.woff2",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
];

// Files that change often: always try the network first, so updates show up
// immediately when online, falling back to cache only when offline.
const NETWORK_FIRST = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests; let cross-origin (e.g. Open Food Facts) pass through to the network untouched.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  const isNetworkFirst = NETWORK_FIRST.some((p) => url.pathname.endsWith(p.replace("./", "/")) || (p === "./" && url.pathname === "/"));

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Static assets (fonts, icons, barcode library): cache-first, they never change.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
