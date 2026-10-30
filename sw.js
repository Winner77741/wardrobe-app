// Offline support for the home-screen app: keeps a copy of the app's own files
// so it opens without internet. Your closet isn't here; it's in the app's storage.
// The cache name and file list below are filled in by scripts/build-web.js.
const CACHE = "wardrobe-fbf13d522205";
const FILES = ["./","app.js?v=dc2ab9fe29","bulk.js?v=fb370c223a","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest","outfits.js?v=a94525e820","phone-bundle.js?v=b3164f3198","styles.css?v=7ff84b4e5b","trips.js?v=ff3bce4204","weather.js?v=6d0f0bbf8b"];

// Always fetch fresh copies here: the browser's own short-term memory may still
// hold files from the previous version, and a mix of old and new could break the app.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

// A new version replaces the old copy.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The app's own files come from the saved copy; everything else (like the AI
// service) goes to the internet as normal.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
