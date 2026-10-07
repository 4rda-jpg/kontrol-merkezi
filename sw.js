// Uygulama dosyalarını telefonda saklar. Önce sunucudan en güncelini ister, internet yoksa
// saklanan kopyayı verir; böylece güncellemeden sonra eski ve yeni dosyalar hiç karışmaz.
const CACHE = "km-v8";
const FILES = [
  "./", "index.html", "style.css", "app.js", "deck.js", "manifest.webmanifest", "vendor/mqtt.min.js",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon.png",
];

self.addEventListener("install", (e) => {
  // cache: "reload" → tarayıcının kendi hafızasını atlayıp dosyaları sunucudan taze çek
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        // no-cache: dosya değişmediyse sunucu sadece "aynı" der, tekrar indirilmez
        const res = await fetch(e.request, { cache: "no-cache" });
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
      }
    }),
  );
});
