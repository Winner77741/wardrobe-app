// Offline support for the home-screen app: keeps a copy of the app's own files
// so it opens without internet. Your closet isn't here; it's in the app's storage.
// The cache name and file list below are filled in by scripts/build-web.js.
const CACHE = "wardrobe-504c9b898cb1";
const FILES = ["./","app.js","bulk.js","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest","outfits.js","phone-bundle.js","styles.css","trips.js","weather.js"];

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
