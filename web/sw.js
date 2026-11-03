/* Service worker: keeps the app usable without internet (the app shell is cached).
 * VERSION is stamped with the commit on every publish (.github/workflows/pages.yml), so every release is a new
 * service worker and phones update by themselves; the number here only matters when testing locally. */
var VERSION = 'catat999-v14';
var SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'seed-demo.js', 'mock-api.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  // cache: 'reload' = straight from the server: GitHub Pages lets browsers keep files for 10 minutes, and a new
  // version filled from that copy would still be the old app
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Same-origin GETs: answer from cache, refresh the cache in the background. API calls (POST to Google) are not touched.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // config.js (the spreadsheet link) and the page itself: network first, so a newly set link is used straight away
  var p = new URL(req.url).pathname;
  if (/\/(config\.js|index\.html)?$/.test(p)) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); }));
    return;
  }
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req, { cache: 'no-cache' }).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
