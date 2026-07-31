// 지금은 캐싱 없이, PWA로 설치 가능하게 만드는 최소한의 역할만 합니다.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  // 오프라인 캐싱이 필요해지면 여기에 로직을 추가하면 됩니다.
});
