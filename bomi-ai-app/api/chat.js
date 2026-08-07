// 이 파일은 브라우저가 아니라 Vercel 서버에서 실행됩니다.
// 그래서 여기 있는 API 키는 사용자에게 절대 노출되지 않아요.
//
// 실제 AI 호출 로직은 ../lib/aiProviders.mjs에 있습니다. 기본은 Gemini
// 무료 티어이고, AI_PROVIDER=anthropic 환경변수로 Claude로 수동 전환할 수
// 있어요 (자동 폴백 아님 — 예상치 못한 과금을 막기 위한 의도적 설계).
import { callAI, analyzeMealPhoto } from '../lib/aiProviders.mjs';
import { calculateBaziPillars, describeBaziPillarsKorean } from '../lib/bazi.mjs';
import { convertLunarToSolar } from '../lib/lunarConvert.mjs';
import { reverseGeocode } from '../lib/transit.mjs';
import { incrementDailyUsage, addMealLog } from '../lib/supabaseAdmin.mjs';
import { todayKeyKST } from '../lib/usage.mjs';

const MAX_MEAL_PHOTO_BASE64_LEN = 4_000_000; // 대략 3MB 원본 — 클라이언트가 미리 리사이즈해서 보냄

// 건강리포트 "식사" 체크인 — 사진(카메라 촬영 또는 갤러리에서 선택, 있으면
// Gemini 비전으로 짧게 코멘트) 또는 사진을 못 찍었을 때의 대체 수단인
// mealScore(0~5)를 bomi_meal_logs에 저장합니다. 일반 대화(callAI)와 같은
// 엔드포인트를 쓰지만 별도 새 api/ 파일을 만들지 않으려고 요청 바디의
// mealLog 유무로 갈라냅니다.
async function handleMealLog(req, res, mealLog) {
  const { bomiLinkCode, date, mealType, photoBase64, mimeType, description, mealScore } = mealLog;
  if (!bomiLinkCode || !date || !mealType) {
    res.status(400).json({ ok: false, message: 'bomiLinkCode, date, mealType이 필요해요.' });
    return;
  }
  if (!photoBase64 && !description && mealScore === undefined) {
    res.status(400).json({ ok: false, message: '사진, 설명, 점수 중 하나는 있어야 해요.' });
    return;
  }
  if (photoBase64 && photoBase64.length > MAX_MEAL_PHOTO_BASE64_LEN) {
    res.status(400).json({ ok: false, message: '사진 용량이 너무 커요. 다시 찍어서 보내주시겠어요?' });
    return;
  }
  try {
    let aiAnalysis = null;
    if (photoBase64) {
      try {
        aiAnalysis = await analyzeMealPhoto(photoBase64, mimeType || 'image/jpeg');
      } catch (e) {
        aiAnalysis = null; // 분석 실패해도 사진 자체는 저장 — 리포트에 "사진만 기록됨"으로 남게
      }
    }
    const saved = await addMealLog(bomiLinkCode, date, mealType, {
      description: description || null,
      photoDataUri: photoBase64 ? `data:${mimeType || 'image/jpeg'};base64,${photoBase64}` : null,
      aiAnalysis,
      mealScore,
    });
    res.status(200).json({ ok: true, mealLog: saved, aiAnalysis });
  } catch (e) {
    res.status(200).json({ ok: false, message: '식사 기록을 저장하지 못했어요.' });
  }
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
    const { system, messages, sajuBirth, location, mealLog } = req.body || {};
    if (mealLog) {
      await handleMealLog(req, res, mealLog);
      return;
    }
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages 배열이 필요해요.' });
      return;
    }

    const fullSystem = (system || '') + await buildSajuContext(sajuBirth) + await buildLocationContext(location);
    const reply = await callAI(fullSystem, messages, { maxTokens: 500 });
    // 헤더의 "대화 가능량" 게이지용 사용량 집계 — 실패해도 채팅 응답 자체를
    // 막으면 안 되므로 별도로 잡아서 무시합니다(fire-and-forget).
    incrementDailyUsage(todayKeyKST()).catch(() => {});
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
