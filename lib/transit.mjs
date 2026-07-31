// 대중교통 길찾기 — 카카오 로컬 API(목적지 이름 → 좌표, 지오코딩) + ODsay API
// (좌표 두 개 → 실제 버스/지하철 경로)를 조합합니다. AI가 경로·시간·요금을
// 직접 지어내지 않도록, 여기서 얻은 실제 값만 system 프롬프트에 사실로
// 넣어주고 AI는 그걸 친절하게 설명하는 역할만 담당합니다(api/chat.js 참고).
//
// 환경변수 2개가 필요합니다:
// - KAKAO_REST_API_KEY: https://developers.kakao.com → 애플리케이션 추가 → REST API 키
// - ODSAY_API_KEY: https://lab.odsay.com → 회원가입 → 애플리케이션 등록 →
//   **Server** API 키 (Web 키 아님 — 서버에서 호출하므로 Server 키가 필요합니다)
// 둘 중 하나라도 없거나 API 호출이 실패하면 null을 반환하고, 호출부(api/chat.js)가
// "못 찾았다"고 안내하도록 넘깁니다 — 절대 조용히 틀린 값을 만들어내지 않습니다.

export async function geocodePlace(query) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key || !query) return null;
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!response.ok) return null;
    const data = await response.json();
    const first = data?.documents?.[0];
    if (!first) return null;
    return {
      lat: Number(first.y),
      lng: Number(first.x),
      placeName: first.place_name,
      address: first.road_address_name || first.address_name || '',
    };
  } catch (e) {
    return null;
  }
}

export async function searchTransitRoute({ startLat, startLng, endLat, endLng }) {
  const key = process.env.ODSAY_API_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({
      apiKey: key,
      SX: String(startLng), SY: String(startLat),
      EX: String(endLng), EY: String(endLat),
    });
    const response = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    const path = data?.result?.path?.[0];
    return path || null;
  } catch (e) {
    return null;
  }
}

const TRAFFIC_TYPE_LABEL = { 1: '지하철', 2: '버스' };

export function describeTransitRouteKorean(path, destination) {
  if (!path) return null;
  const info = path.info || {};
  const steps = (path.subPath || [])
    .filter(sp => sp.trafficType === 1 || sp.trafficType === 2)
    .map(sp => {
      const label = TRAFFIC_TYPE_LABEL[sp.trafficType] || '이동';
      const laneName = sp.lane && sp.lane[0] && sp.lane[0].name ? sp.lane[0].name : '';
      return `${label}${laneName ? ' ' + laneName : ''}(${sp.startName}→${sp.endName}, 약 ${sp.sectionTime}분, ${sp.stationCount}개 정류장)`;
    });
  const parts = [
    `목적지: ${destination.placeName}${destination.address ? ' (' + destination.address + ')' : ''}`,
    `총 소요시간 약 ${info.totalTime}분`,
    info.payment !== undefined ? `요금 약 ${info.payment}원` : null,
    `환승: 버스 ${info.busTransitCount || 0}회, 지하철 ${info.subwayTransitCount || 0}회`,
  ].filter(Boolean);
  if (steps.length) parts.push(`경로: ${steps.join(' → ')}`);
  return parts.join(', ');
}
