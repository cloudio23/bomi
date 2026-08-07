// 카카오톡 알림톡(가족 리포트) 발송 — lib/sms.mjs와 동일한 패턴(SDK 없이
// SOLAPI REST API를 HMAC-SHA256으로 직접 서명해 호출)입니다. SOLAPI가
// 문자·알림톡을 같은 발송 엔드포인트(messages/v4/send-many/detail)로
// 처리하고, kakaoOptions만 추가하면 알림톡으로 발송된다는 걸 공식
// solapi-nodejs SDK 소스로 확인했습니다.
//
// 사전 준비(코드와 무관하게 사용자가 직접 해야 하는 절차):
// 1) 카카오톡 채널(비즈니스 채널) 개설
// 2) SOLAPI 콘솔에서 그 채널을 연동 → pfId 발급
// 3) 알림톡 템플릿 등록 후 카카오 심사(승인, 보통 1~3영업일) → templateId 발급
// 4) 아래 환경변수를 채우면 그때부터 실제 발송 시작 (그 전까지는 조용히
//    ok:false를 돌려줘서 주간 리포트 자체가 깨지진 않음)
//
// 환경변수:
// - SOLAPI_API_KEY / SOLAPI_API_SECRET: lib/sms.mjs와 동일한 키 재사용 가능
// - KAKAO_SENDER_PHONE: 카카오 채널 연동 시 등록한 발신번호(하이픈 없이)
// - KAKAO_PF_ID: 카카오 비즈니스 채널의 pfId
// - KAKAO_WEEKLY_TEMPLATE_ID: 주간 가족 리포트 알림톡 템플릿 ID
import { createHmac, randomBytes } from 'crypto';

const SEND_ENDPOINT = 'https://api.solapi.com/messages/v4/send-many/detail';

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

// variables는 { "#{변수명}": "값" } 형태 — 카카오 심사를 통과한 템플릿의
// 변수 이름과 정확히 일치해야 합니다.
export async function sendAlimtalk(toPhone, templateId, variables) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const from = process.env.KAKAO_SENDER_PHONE;
  const pfId = process.env.KAKAO_PF_ID;
  if (!apiKey || !apiSecret || !from || !pfId || !templateId) {
    return { ok: false, message: '알림톡 발송이 아직 설정되지 않았어요.' };
  }
  try {
    const response = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(apiKey, apiSecret),
      },
      body: JSON.stringify({
        messages: [{
          to: String(toPhone).replace(/-/g, ''),
          from,
          kakaoOptions: { pfId, templateId, variables },
        }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: data?.errorMessage || `알림톡 발송 실패 (status ${response.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
