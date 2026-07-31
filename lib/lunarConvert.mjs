// 음력 생년월일 → 양력 변환 (한국천문연구원 KASI, 공공데이터포털 "특일 정보" API,
// 서비스명 LrsrCldInfoService의 getSolCalInfo 오퍼레이션).
// 사주팔자 년/월/일주는 절기 기준의 "양력" 날짜로 계산해야 정확해서, 음력으로
// 알고 계신 생일은 이 API로 먼저 양력으로 바꾼 뒤 lib/bazi.mjs에 넘깁니다.
//
// KASI_SERVICE_KEY 환경변수가 필요합니다 — 공공데이터포털(data.go.kr)에서
// "한국천문연구원_음양력 정보" 데이터셋(15012679) 활용신청 후 발급받은 서비스키를
// 등록하세요. 키가 없거나 API 호출이 실패하면 null을 반환합니다(호출부가 연도
// 중심의 안전한 문구로 자동 대체 — 변환 실패를 없는 셈 치지 않고 명확히 알림).
const KASI_BASE_URL = 'http://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getSolCalInfo';

export async function convertLunarToSolar({ year, month, day, isLeapMonth }) {
  const serviceKey = process.env.KASI_SERVICE_KEY;
  if (!serviceKey) return null;

  const params = new URLSearchParams({
    ServiceKey: serviceKey,
    lunYear: String(year),
    lunMonth: String(month).padStart(2, '0'),
    lunDay: String(day).padStart(2, '0'),
    leapMonth: isLeapMonth ? '윤' : '평',
    _type: 'json',
  });

  try {
    const response = await fetch(`${KASI_BASE_URL}?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    const item = data?.response?.body?.items?.item;
    const row = Array.isArray(item) ? item[0] : item;
    if (!row || !row.solYear) return null;
    return {
      year: Number(row.solYear),
      month: Number(row.solMonth),
      day: Number(row.solDay),
    };
  } catch (e) {
    return null;
  }
}
