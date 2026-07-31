// 이 파일은 브라우저가 아니라 Vercel 서버에서 실행됩니다.
// 그래서 여기 있는 API 키는 사용자에게 절대 노출되지 않아요.
//
// 실제 AI 호출 로직은 ../lib/aiProviders.mjs에 있습니다. 기본은 Gemini
// 무료 티어이고, AI_PROVIDER=anthropic 환경변수로 Claude로 수동 전환할 수
// 있어요 (자동 폴백 아님 — 예상치 못한 과금을 막기 위한 의도적 설계).
import { callAI } from '../lib/aiProviders.mjs';
import { calculateBaziPillars, describeBaziPillarsKorean } from '../lib/bazi.mjs';
import { convertLunarToSolar } from '../lib/lunarConvert.mjs';
import { geocodePlace, resolvePlace, searchTransitRoutes, pickRoutes, describeRoutesKorean } from '../lib/transit.mjs';

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

// 길찾기 흐름(index.html의 startTransitFlow)에서 출발지/목적지/선호 교통수단이
// 오면, 카카오 로컬 API로 출발지·목적지를 좌표로 바꾸고 ODsay API로 실제
// 경로들을 조회해서 그 결과를 system 프롬프트에 사실로 넣습니다 — AI는
// 경로/시간/요금을 직접 지어내지 않고 이미 조회된 값만 설명합니다. 지오코딩·
// 경로 조회 중 하나라도 실패하면(키 미설정, 장소 못 찾음 등) "못 찾았다"고
// 솔직히 안내하도록 지시할 뿐, 절대 그럴듯한 가짜 경로를 만들어내라고 하지 않습니다.
//
// 참고: "정류장에 실제로 몇 분 후 버스가 도착하는지"(실시간 도착 예측)는
// ODsay가 주지 않는 정보라(경로/소요시간까지만 제공) 여기 포함하지 않았습니다 —
// 필요하면 TAGO(국가대중교통정보센터) API를 별도로 더 붙여야 합니다.
async function buildTransitContext(transitQuery) {
  if (!transitQuery || !transitQuery.destination || !transitQuery.origin) return '';

  const origin = await resolvePlace(transitQuery.origin);
  if (!origin) {
    const originLabel = transitQuery.origin.text || '출발지';
    return `\n\n[교통 참고 정보] "${originLabel}"의 위치를 찾지 못했어요. 구체적인 경로·시간을 절대 지어내지 말고, 출발지를 못 찾았다고 안내한 뒤 더 구체적으로 다시 말씀해달라고 요청하세요.`;
  }

  const dest = await geocodePlace(transitQuery.destination);
  if (!dest) {
    return `\n\n[교통 참고 정보] "${transitQuery.destination}"의 위치를 찾지 못했어요. 구체적인 경로·시간을 절대 지어내지 말고, 목적지를 못 찾았다고 안내한 뒤 조금 더 구체적으로(예: 정확한 지명) 다시 말씀해달라고 요청하세요.`;
  }

  const paths = await searchTransitRoutes({
    startLat: origin.lat, startLng: origin.lng,
    endLat: dest.lat, endLng: dest.lng,
  });
  if (!paths) {
    return `\n\n[교통 참고 정보] ${origin.placeName}에서 "${transitQuery.destination}"(${dest.placeName})까지 가는 대중교통 경로를 찾지 못했어요. 구체적인 시간·노선·요금을 절대 지어내지 말고, 경로 조회에 실패했다고 솔직히 안내하세요.`;
  }

  const routes = pickRoutes(paths, transitQuery.preference || 'any');
  return `\n\n[교통 참고 정보] 아래는 실제로 조회된 대중교통 경로 ${routes.length}개입니다(출발지: ${origin.placeName}). 각 경로를 "경로 1", "경로 2"로 구분해서 이 정보를 사실로 삼아 친절하게 설명하세요(직접 계산하거나 지어내지 마세요, 정류장 도보 시간·탑승 노선·환승·총 소요시간을 그대로 전달):\n${describeRoutesKorean(routes, dest)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }

  try {
    const { system, messages, sajuBirth, transitQuery } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages 배열이 필요해요.' });
      return;
    }

    const fullSystem = (system || '') + await buildSajuContext(sajuBirth) + await buildTransitContext(transitQuery);
    const reply = await callAI(fullSystem, messages, { maxTokens: 500 });
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
