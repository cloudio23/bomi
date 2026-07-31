// 대중교통 길찾기 — 카카오 로컬 API(장소 이름 → 좌표, 지오코딩) + ODsay API
// (좌표 두 개 → 실제 버스/지하철 경로 여러 개)를 조합합니다. AI가 경로·시간·
// 요금을 직접 지어내지 않도록, 여기서 얻은 실제 값만 system 프롬프트에 사실로
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

// place는 세 가지 형태로 옵니다:
// - {lat, lng, placeName, text} — 자동완성 목록에서 직접 골라 좌표가 이미 확정된 경우(가장 정확)
// - {lat, lng} — GPS로 확보한 현재 위치(자동완성 없이 출발지를 비워둔 경우)
// - {text} — 자동완성 없이 직접 타이핑만 한 경우, 여기서 지오코딩 필요
export async function resolvePlace(place) {
  if (place.lat !== undefined && place.lng !== undefined) {
    return { lat: place.lat, lng: place.lng, placeName: place.placeName || place.text || '현재 위치', address: '' };
  }
  if (place.text) return geocodePlace(place.text);
  return null;
}

// ODsay는 기본적으로 여러 경로 후보(path 배열)를 반환합니다 — 하나만 쓰지 않고
// 전부 받아서 pickRoutes()에서 선호도에 맞게 고릅니다.
export async function searchTransitRoutes({ startLat, startLng, endLat, endLng }) {
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
    const paths = data?.result?.path;
    return Array.isArray(paths) && paths.length ? paths : null;
  } catch (e) {
    return null;
  }
}

// preference: 'bus' | 'subway' | 'any'. 선호 교통수단이 포함된 경로를 우선하되,
// 그런 경로가 없으면(예: 지하철이 아예 없는 지역) 전체 중 상위 2개로 대체합니다.
export function pickRoutes(paths, preference) {
  const sorted = [...paths].sort((a, b) => (a.info?.totalTime ?? 999) - (b.info?.totalTime ?? 999));
  let filtered = sorted;
  if (preference === 'bus') filtered = sorted.filter(p => (p.info?.busTransitCount ?? 0) > 0);
  else if (preference === 'subway') filtered = sorted.filter(p => (p.info?.subwayTransitCount ?? 0) > 0);
  if (!filtered.length) filtered = sorted;
  return filtered.slice(0, 2);
}

const TRAFFIC_TYPE_LABEL = { 1: '지하철', 2: '버스' };

// 지하철은 lane[0].name(예: "수도권 2호선"), 버스는 lane[0].busNo(예: "341")에
// 노선 식별자가 들어있음 — 필드명이 서로 달라서 trafficType별로 나눠서 읽습니다.
function laneLabel(sp) {
  const lane = sp.lane && sp.lane[0];
  if (!lane) return '';
  if (sp.trafficType === 2) return lane.busNo ? `${lane.busNo}번` : '';
  return lane.name || '';
}

function describeOneRoute(path, index) {
  const info = path.info || {};
  const subPaths = path.subPath || [];

  // 첫 도보 구간(정류장/역까지 걸어가는 시간) — trafficType 3이 보통 도보.
  const firstWalk = subPaths[0] && subPaths[0].trafficType === 3 ? subPaths[0] : null;
  const firstRide = subPaths.find(sp => sp.trafficType === 1 || sp.trafficType === 2);

  const parts = [`경로 ${index + 1}`];
  if (firstWalk) parts.push(`도보 약 ${firstWalk.sectionTime}분 이동`);
  if (firstRide) {
    const label = TRAFFIC_TYPE_LABEL[firstRide.trafficType] || '이동';
    const laneName = laneLabel(firstRide);
    parts.push(`${firstRide.startName}에서 ${label}${laneName ? ' ' + laneName : ''} 탑승(${firstRide.stationCount}개 정류장, 약 ${firstRide.sectionTime}분)`);
  }
  const transferSteps = subPaths
    .filter(sp => (sp.trafficType === 1 || sp.trafficType === 2) && sp !== firstRide)
    .map(sp => {
      const label = TRAFFIC_TYPE_LABEL[sp.trafficType] || '이동';
      const laneName = laneLabel(sp);
      return `${label}${laneName ? ' ' + laneName : ''}로 환승(${sp.startName}→${sp.endName}, 약 ${sp.sectionTime}분)`;
    });
  if (transferSteps.length) parts.push(...transferSteps);
  parts.push(`총 소요시간 약 ${info.totalTime}분`);
  if (info.payment !== undefined) parts.push(`요금 약 ${info.payment}원`);
  return parts.join(', ');
}

export function describeRoutesKorean(routes, destination) {
  if (!routes || !routes.length) return null;
  const header = `목적지: ${destination.placeName}${destination.address ? ' (' + destination.address + ')' : ''}`;
  const routeLines = routes.map((r, i) => describeOneRoute(r, i));
  return [header, ...routeLines].join('\n');
}
