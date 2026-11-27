// Voo Agrícola: guarda o jogo no aparelho para abrir sem internet.
// A página vem sempre da rede quando há sinal (para receber atualizações) e do cache quando não há.
var CACHE = 'voo-agricola-1';
var CORE = ['./', 'icon-192.png', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(CORE.map(function (u) { return c.add(new Request(u, { mode: u.indexOf('http') === 0 ? 'cors' : 'same-origin' })).catch(function () { }); })); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var r = e.request; if (r.method !== 'GET') return;
  var keep = function (res) { if (res && (res.ok || res.type === 'opaque')) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); } return res; };
  if (r.mode === 'navigate' || r.url.indexOf(self.registration.scope) === 0) e.respondWith(fetch(r).then(keep).catch(function () { return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || caches.match('./'); }); }));
  else e.respondWith(caches.match(r).then(function (m) { return m || fetch(r).then(keep); }));
});
