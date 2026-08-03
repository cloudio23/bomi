// 지금은 캐싱 없이, PWA로 설치 가능하게 만드는 최소한의 역할 + 웹 푸시 수신만 합니다.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  // 오프라인 캐싱이 필요해지면 여기에 로직을 추가하면 됩니다.
});

// 서버(api/link.js의 ?action=notify, api/notifications.js의 ?action=greeting)가 보낸 푸시를 받아서
// 배너로 띄웁니다. 앱이 닫혀있어도(카톡처럼) 동작하는 게 이 부분의 핵심입니다.
self.addEventListener('push', (e) => {
  let data = { title: '보미', body: '', type: '' };
  try { data = { ...data, ...e.data.json() }; } catch (err) { /* 페이로드 없는 ping은 무시 */ }
  e.waitUntil(
    self.registration.showNotification(data.title || '보미', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { type: data.type || '' },
    })
  );
});

// 알림을 탭하면 앱을 열되, 연동 요청 알림이면 동의 화면으로 바로 가도록
// 쿼리 파라미터를 붙여서 index.html이 로드 직후 바로 확인할 수 있게 합니다.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const notifType = e.notification.data && e.notification.data.type;
  const targetUrl = notifType === 'link_request' ? '/?consent=1'
    : notifType === 'health_report_ready' ? '/?report=1'
    : '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
