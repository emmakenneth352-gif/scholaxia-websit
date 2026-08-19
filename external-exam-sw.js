self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open("scholaxia-exam-hall-v1").then(function (cache) {
      return cache.addAll([
        "external-exam.html",
        "css/external-exam.css?v=1",
        "js/api.js?v=20260819s",
        "js/external-exam.js?v=1",
        "media/logo-main.png",
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        return res;
      }).catch(function () {
        return cached;
      });
    })
  );
});
