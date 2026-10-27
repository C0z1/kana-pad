// Offline support: app files are cached on install; Google Fonts are cached the first time they load.
// Bump VERSION whenever any file in APP changes so installed copies pick up the new release.
const VERSION = "kana-pad-v0.4.0";
const APP = [
  "./", "index.html", "manifest.webmanifest", "css/styles.css",
  "js/app.js", "js/data.js", "js/srs.js", "js/gamepad.js", "js/scheduler.js", "js/storage.js", "js/strokes.js",
  "js/vendor/ts-fsrs.mjs", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];
const KANJI = "一二三四五六七八九十日月火水木金土人山川口目手大小上下中年学";
const STROKES = [...KANJI].map(k => `content/kanjivg/${k.codePointAt(0).toString(16).padStart(5, "0")}.svg`);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll([...APP, ...STROKES])).then(() => self.skipWaiting()));
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
