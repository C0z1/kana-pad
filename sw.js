// Offline support: app files are cached on install; Google Fonts are cached the first time they load.
// Bump VERSION whenever any file in APP changes so installed copies pick up the new release.
const VERSION = "kana-pad-v0.6.0-dev1";
const APP = [
  "./", "index.html", "manifest.webmanifest", "css/styles.css",
  "js/app.js", "js/data.js", "js/srs.js", "js/gamepad.js", "js/scheduler.js", "js/storage.js", "js/strokes.js", "js/progress.js", "js/exam.js",
  "js/vendor/ts-fsrs.mjs", "js/content/vocab-n5.js", "js/content/kanji-n5.js", "js/content/grammar-n5.js", "js/content/reading-n5.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];
// Stroke files for every N5 kanji, listed by the content pipeline.
const STROKES = "content/kanjivg/n5.json";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION)
    .then(async c => {
      await c.addAll(APP);
      await c.addAll(await (await fetch(STROKES)).json());
    })
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !isFont) return;
  // Network first for our own files so a new release shows up right away; cache when offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
