// Offline support: app files are cached on install; Google Fonts are cached the first time they load.
// Bump VERSION whenever any file in APP changes so installed copies pick up the new release.
const VERSION = "kana-pad-v0.9.0";
// Voice clips are named after the text they say, so a cached clip never goes stale: they live in their
// own cache that survives releases instead of being downloaded again (all three voices are ~73 MB).
const AUDIO = "kana-pad-audio";
const APP = [
  "./", "index.html", "manifest.webmanifest", "css/styles.css",
  "js/app.js", "js/data.js", "js/srs.js", "js/gamepad.js", "js/scheduler.js", "js/storage.js", "js/strokes.js", "js/progress.js", "js/exam.js", "js/listening.js", "js/stories.js", "js/voices.js",
  "js/vendor/ts-fsrs.mjs", "js/content/vocab-n5.js", "js/content/kanji-n5.js", "js/content/grammar-n5.js", "js/content/reading-n5.js", "js/content/stories-n5.js",
  "js/placement.js", "js/draw.js", "js/backup.js", "js/clips.js", "js/dashboard.js", "js/merge.js", "js/cloud.js", "js/icons.js", "js/challenges.js", "js/achievements.js", "js/sfx.js", "js/content/vocab-n4.js", "js/content/kanji-n4.js", "js/content/grammar-n4.js", "js/content/vocab-n3.js", "js/content/kanji-n3.js", "js/content/grammar-n3.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
];
// Stroke files for every N5 kanji, listed by the content pipeline.
const STROKES = "content/kanjivg/strokes.json";

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
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== AUDIO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== location.origin && !isFont) return;
  if (url.pathname.includes("/audio/")) return e.respondWith(audioClip(url.href));
  // Network first for our own files so a new release shows up right away; cache when offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.status === 200 || res.type === "opaque") { // never a partial (206) response
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        // Only a page falls back to the app shell; a missing clip or SVG must fail so the app can react.
        .then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});

// Cache first. <audio> asks with a Range header and gets a partial 206 that can't be cached, so the
// clip is fetched whole once; if the network fails the error reaches the app, which uses the system voice.
async function audioClip(href) {
  const c = await caches.open(AUDIO);
  const hit = await c.match(href);
  if (hit) return hit;
  const res = await fetch(href);
  if (res.status === 200) c.put(href, res.clone());
  return res;
}
