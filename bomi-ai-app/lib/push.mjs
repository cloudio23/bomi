// Web Push 발송 헬퍼 — RFC 8291 암호화는 직접 구현하지 않고 검증된 web-push
// 패키지에 위임합니다 (이 프로젝트의 첫 npm 의존성).
//
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY는 한 쌍으로 발급된 키를 그대로 써야 합니다.
// PUBLIC 키는 index.html 클라이언트에도 노출되는 값(그래서 이름이 public)이고,
// PRIVATE 키는 절대 커밋하지 말고 Vercel 환경변수로만 등록하세요.
import webpush from 'web-push';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 환경변수가 설정되어 있지 않아요.');
  }
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'}`,
    publicKey,
    privateKey
  );
  configured = true;
}

// subscription 저장 당시 형식이 깨졌거나(만료된 구독 등) 상대 브라우저가
// 구독을 취소한 경우 web-push가 410/404를 던지는데, 이건 발송 실패로 앱을
// 죽일 이유가 없는 정상적인 상황이라 호출부에서 개별적으로 무시할 수 있게
// 에러를 그대로 던집니다 (여기서 삼키지 않음 — 호출부가 구독 삭제 등 판단).
export async function sendPush(subscription, payload) {
  ensureConfigured();
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}
