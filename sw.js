/* ===================================================================
   짬짬이 영상 — 오프라인 지원 서비스 워커
   ===================================================================
   전략
   - 영상 목록(data/*.json) · 런처 HTML → Network-First
     새로 추가한 영상이 곧바로 보여야 하므로 항상 네트워크를 먼저 본다.
     느린 회선에서 첫 화면이 오래 막히지 않도록 NETWORK_TIMEOUT_MS 뒤에는
     캐시로 응답하고, 네트워크 응답은 끝까지 받아 다음 방문용 캐시를 갱신한다.
   - 나머지 정적 자산(css · js · 웹폰트 · 아이콘) → Stale-While-Revalidate
     캐시로 즉시 응답해 빠르게 뜨고, 배경에서 새 파일을 받아 다음 방문에 반영한다.
     배포 파이프라인의 캐시 무효화에 의존하지 않는다.

   유튜브(썸네일 i.ytimg.com · 임베드)는 교차 출처라 가로채지 않는다.
   → 영상 재생 자체는 인터넷이 필요하다. 오프라인에서는 목록·검색·저장함이 동작한다.
   =================================================================== */

const CACHE_NAME = 'jjamvideo-v1';
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './shared/jjam-switcher.js',
  './data/videos.index.json',
  './data/videos.detail.json',
  './favicon.svg',
  './manifest.json',
  './assets/fonts/PretendardVariable.subset.woff2'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(PRECACHE); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
                             .map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

var SCOPE_PATH = new URL('./', self.location).pathname;

// 목록을 결정하는 파일 — 항상 최신을 우선한다.
function isDirectoryFile(url) {
  var p = new URL(url).pathname;
  return p === SCOPE_PATH || p.endsWith('/index.html') ||
         p.endsWith('/data/videos.index.json') || p.endsWith('/data/videos.detail.json') ||
         p.endsWith('/manifest.json');
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  // 교차 출처(유튜브 등)는 건드리지 않는다.
  if (!event.request.url.startsWith(self.location.origin)) return;

  if (isDirectoryFile(event.request.url)) {
    var networkFetch = fetch(event.request, { cache: 'no-cache' }).then(function (response) {
      if (response.ok) {
        var clone = response.clone();
        return caches.open(CACHE_NAME).then(function (cache) { return cache.put(event.request, clone); })
          .then(function () { return response; });
      }
      return response;
    });
    // 캐시가 먼저 응답해도 네트워크 요청은 끝까지 진행해 다음 방문용 캐시를 갱신한다.
    event.waitUntil(networkFetch.then(null, function () {}));

    event.respondWith(
      Promise.race([
        networkFetch.then(null, function () { return null; }),
        new Promise(function (resolve) { setTimeout(function () { resolve(null); }, NETWORK_TIMEOUT_MS); })
      ]).then(function (response) {
        if (response) return response;
        return caches.match(event.request).then(function (cached) {
          return cached || networkFetch;   // 캐시도 없으면 네트워크를 끝까지 기다린다
        });
      }).catch(function () {
        return new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // Stale-While-Revalidate: 정적 자산
  var revalidate = fetch(event.request, { cache: 'no-cache' }).then(function (response) {
    if (response.ok) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
    }
    return response;
  });
  event.waitUntil(revalidate.then(null, function () {}));

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return revalidate.catch(function () { return new Response('Offline', { status: 503 }); });
    })
  );
});
