// 보이스피싱 의심 알림 문자 발송 — SOLAPI(옛 CoolSMS) REST API를 SDK 없이
// raw fetch로 호출합니다(다른 lib/*.mjs와 같은 무의존성 스타일 유지).
// HMAC 서명 방식은 SOLAPI 공식 solapi-nodejs SDK 소스(src/lib/authenticator.ts,
// src/services/messages/messageService.ts)를 그대로 재현했습니다 — docs.solapi.com은
// 이 환경에서 접근이 안 돼서, 실제로 API를 구현한 오픈소스 SDK 코드를 근거로 삼았습니다.
//
// 문자 발송은 한국 법(정보통신망법)상 발신번호 사전등록이 필수라, SOLAPI 콘솔에서
// SOLAPI_SENDER_PHONE 번호를 먼저 등록하고 승인받아야 실제로 발송됩니다. 그 전까지는
// 아래 함수가 조용히 ok:false를 돌려줘서(다른 lib들과 같은 패턴) 채팅 자체는 안 깨집니다.
//
// 환경변수:
// - SOLAPI_API_KEY / SOLAPI_API_SECRET: solapi.com 콘솔 → API Key 발급
// - SOLAPI_SENDER_PHONE: 사전 등록·승인된 발신번호 (하이픈 없이, 예: 0212345678)
import { createHmac, randomBytes } from 'crypto';

const SEND_ENDPOINT = 'https://api.solapi.com/messages/v4/send-many/detail';

// SOLAPI가 서명에 쓰는 date는 date-fns의 formatISO(밀리초 없는 확장 ISO8601,
// 'Z' 대신 숫자 오프셋) 형식이라 그대로 맞춰 직접 포맷합니다.
function isoDateNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offMin) / 60));
  const om = pad(Math.abs(offMin) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

function authHeader(apiKey, apiSecret) {
  const date = isoDateNow();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function sendSms(toPhone, text) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const from = process.env.SOLAPI_SENDER_PHONE;
  if (!apiKey || !apiSecret || !from) {
    return { ok: false, message: '문자 발송이 아직 설정되지 않았어요.' };
  }
  try {
    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(apiKey, apiSecret),
      },
      body: JSON.stringify({
        messages: [{ to: String(toPhone).replace(/-/g, ''), from, text }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: data?.errorMessage || `문자 발송 실패 (status ${response.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
