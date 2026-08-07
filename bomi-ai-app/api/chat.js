// 이 파일은 브라우저가 아니라 Vercel 서버에서 실행됩니다.
// 그래서 여기 있는 API 키는 사용자에게 절대 노출되지 않아요.
//
// 실제 AI 호출 로직은 ../lib/aiProviders.mjs에 있습니다. 기본은 Gemini
// 무료 티어이고, AI_PROVIDER=anthropic 환경변수로 Claude로 수동 전환할 수
// 있어요 (자동 폴백 아님 — 예상치 못한 과금을 막기 위한 의도적 설계).
import { callAI } from '../lib/aiProviders.mjs';
import { calculateBaziPillars, describeBaziPillarsKorean } from '../lib/bazi.mjs';
import { convertLunarToSolar } from '../lib/lunarConvert.mjs';
import { reverseGeocode } from '../lib/transit.mjs';
import { incrementDailyUsage, markEngagementSignals } from '../lib/supabaseAdmin.mjs';
import { todayKeyKST } from '../lib/usage.mjs';

// 건강리포트(일간 화면 + 가족 주간 리포트)의 "데이터 부족" 판단용 — 사용자가
// 그날 수면/식사/활동/기분 얘기를 실제로 꺼냈는지만 가볍게 키워드로
// 감지합니다(별도 LLM 호출 없이, 그라운딩 조건부 적용 때와 같은 방식).
// 원문은 저장하지 않고 이 4개 불리언만 남깁니다.
const SLEEP_RE = /잠|수면|주무|잤|불면|꿈/;
const MEAL_RE = /밥|식사|먹었|드셨|아침|점심|저녁|반찬|끼니|간식/;
const ACTIVITY_RE = /운동|산책|걸었|걷기|활동|스트레칭|체조/;
const MOOD_RE = /기분|컨디션|우울|외롭|힘들|즐거|행복|답답|심심|편안/;
function classifyEngagement(text) {
  const t = text || '';
  return {
    sleep: SLEEP_RE.test(t),
    meal: MEAL_RE.test(t),
    activity: ACTIVITY_RE.test(t),
    mood: MOOD_RE.test(t),
  };
}

// 클라이언트가 사주 정보(생년월일시)를 보내면, LLM이 사주팔자를 직접(부정확하게)
// "지어내게" 하는 대신 검증된 만세력 조회 테이블로 정밀 계산해서 그 결과를
// system 프롬프트에 사실로 박아 넣습니다 — AI는 계산이 아니라 해석/서술만 담당.
// 음력은 KASI API(lib/lunarConvert.mjs)로 먼저 양력으로 바꾼 뒤 같은 방식으로
// 계산합니다. KASI_SERVICE_KEY가 아직 없거나 API 호출이 실패하면(변환 실패)
// 연도 중심의 안전한 문구로 자동 대체하고, 마치 정확한 사주팔자를 계산한
// 것처럼 단정적으로 말하지 않도록 지시합니다.
async function buildSajuContext(sajuBirth) {
  if (!sajuBirth || !sajuBirth.monthDay) return '';
  const [month, day] = sajuBirth.monthDay.split('-').map(Number);
  const hour = sajuBirth.hour === undefined ? null : sajuBirth.hour;

  let solar = { year: sajuBirth.year, month, day };
  if (sajuBirth.calendarType === 'lunar') {
    const converted = await convertLunarToSolar({ year: sajuBirth.year, month, day, isLeapMonth: !!sajuBirth.isLeapMonth });
    if (!converted) {
      return `\n\n[사주 참고 정보] 사용자는 음력 ${sajuBirth.year}년 ${month}월 ${day}일생입니다(지금은 음력→양력 변환이 안 돼서 정밀한 사주팔자 계산은 못 했어요). 절대로 음력 날짜를 직접 양력으로 환산하려 하지 말고("양력 ~월 ~일에 해당합니다" 같은 문장 금지), 구체적인 날짜·사주팔자·띠를 단정하지 말고 연도만 언급하며 가볍게 답하세요.`;
    }
    solar = converted;
  }

  const pillars = calculateBaziPillars({ year: solar.year, month: solar.month, day: solar.day, hour });
  if (!pillars) {
    return `\n\n[사주 참고 정보] 사용자는 ${sajuBirth.year}년 ${month}월 ${day}일생입니다(계산 가능 범위 밖이라 정밀 사주팔자는 못 냈어요). 연도 중심으로만 가볍게 답하세요.`;
  }
  return `\n\n[사주 참고 정보] 아래는 정밀하게 계산된 실제 사주팔자입니다. 이 값을 사실로 삼아 해석해서 답하세요(직접 계산하지 말고 이미 계산된 값을 그대로 쓰세요):\n${describeBaziPillarsKorean(pillars)}`;
}

// 대중교통 길찾기는 더 이상 이 엔드포인트를 거치지 않습니다 — api/transit-route.js가
// AI 없이 직접 JSON으로 응답하고, 클라이언트가 카드로 바로 렌더링합니다
// (index.html의 runTransitSearch 참고).

// 날씨(그리고 일반 교통 질문)는 여전히 이 엔드포인트를 거치는데, 위도/경도를
// 그대로 검색어로 넘기면 Gemini의 google_search 그라운딩이 기온·강수량 같은
// 구체적인 수치를 못 찾아왔음(좌표는 검색어로 약함). 카카오 리버스 지오코딩으로
// "OO구 OO동" 같은 실제 지명으로 바꿔서 넘겨줍니다 — 실패하면 좌표로 대체.
async function buildLocationContext(location) {
  if (!location || location.lat === undefined || location.lng === undefined) return '';
  const address = await reverseGeocode(location.lat, location.lng);
  if (address) {
    return `\n\n사용자의 현재 위치: ${address} — 날씨나 교통 관련 질문에는 이 위치를 기준으로("${address} 날씨"처럼 실제 지명으로 검색해서) 답하세요.`;
  }
  return `\n\n사용자의 현재 위치(위도/경도): ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)} — 날씨나 교통 관련 질문에는 이 위치를 기준으로 답하세요.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }

  try {
    const { system, messages, sajuBirth, location, bomiLinkCode } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages 배열이 필요해요.' });
      return;
    }

    const fullSystem = (system || '') + await buildSajuContext(sajuBirth) + await buildLocationContext(location);
    const reply = await callAI(fullSystem, messages, { maxTokens: 500 });
    // 헤더의 "대화 가능량" 게이지용 사용량 집계 — 실패해도 채팅 응답 자체를
    // 막으면 안 되므로 별도로 잡아서 무시합니다(fire-and-forget).
    incrementDailyUsage(todayKeyKST()).catch(() => {});
    // 건강리포트용 참여 신호 기록도 같은 이유로 fire-and-forget.
    if (bomiLinkCode) {
      const lastUserText = messages.length ? messages[messages.length - 1].content : '';
      markEngagementSignals(bomiLinkCode, todayKeyKST(), classifyEngagement(lastUserText)).catch(() => {});
    }
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
