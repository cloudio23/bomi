// 대중교통 길찾기 — 카카오 로컬 API(장소 이름 → 좌표, 지오코딩) + ODsay API
// (좌표 두 개 → 실제 버스/지하철 최적 경로)를 조합합니다. api/transit-route.js가
// 이 결과를 그대로 JSON으로 클라이언트에 돌려주고, 클라이언트는 AI를 거치지
// 않고 카드로 바로 렌더링합니다 — 텍스트 나열보다 훨씬 간결하고, 경로/시간을
// AI가 지어낼 여지 자체가 없습니다.
//
// 환경변수:
// - KAKAO_REST_API_KEY: https://developers.kakao.com → 애플리케이션 추가 → REST API 키
// - ODSAY_PROXY_URL / ODSAY_PROXY_SECRET: ODsay Server 키는 호출하는 서버의
//   고정 IP를 미리 등록해둬야 하는데, Vercel 서버리스 함수는 매번 IP가 바뀌어서
//   직접 호출이 불가능합니다(2026-08-04 확인: ApiKeyAuthFailed). 그래서 고정 IP를
//   가진 소형 VPS(DigitalOcean, Singapore)에 ODsay 키를 두고, 이 VPS가 대신
//   ODsay를 호출해주는 중계 프록시를 세웠습니다 — Vercel은 그 프록시만 호출합니다.
// 키가 없거나 호출이 실패하면 null을 반환하고, 호출부가 "못 찾았다"고 안내하도록
// 넘깁니다 — 절대 조용히 틀린 값을 만들어내지 않습니다.

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

// 좌표 → 사람이 읽는 주소(구/동 단위). 날씨 질문에 위도/경도를 그대로 검색어로
// 넘기면 Google 검색이 좋은 결과를 못 찾아서(좌표 자체는 검색어로 약함) 기온·
// 강수량이 안 나오는 문제가 있었음 — 실제 지명으로 바꿔서 넘기면 "OO구 날씨"처럼
// 검색이 잘 먹힘.
export async function reverseGeocode(lat, lng) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;
  try {
    const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`;
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!response.ok) return null;
    const data = await response.json();
    const addr = data?.documents?.[0]?.address;
    if (!addr) return null;
    return [addr.region_1depth_name, addr.region_2depth_name, addr.region_3depth_name].filter(Boolean).join(' ');
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

export async function searchTransitRoutes({ startLat, startLng, endLat, endLng }) {
  const proxyUrl = process.env.ODSAY_PROXY_URL;
  const proxySecret = process.env.ODSAY_PROXY_SECRET;
  if (!proxyUrl || !proxySecret) return null;
  try {
    const params = new URLSearchParams({
      SX: String(startLng), SY: String(startLat),
      EX: String(endLng), EY: String(endLat),
    });
    const response = await fetch(`${proxyUrl}/odsay/route?${params.toString()}`, {
      headers: { 'X-Proxy-Secret': proxySecret },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const paths = data?.result?.path;
    return Array.isArray(paths) && paths.length ? paths : null;
  } catch (e) {
    return null;
  }
}

// 소요시간이 가장 짧은 경로 하나만 고릅니다 — 버스/지하철 선호를 더는 물어보지
// 않기로 해서(그 질문 자체를 없앰), 그냥 최적 경로 하나로 단순화.
export function pickBestRoute(paths) {
  return [...paths].sort((a, b) => (a.info?.totalTime ?? 999) - (b.info?.totalTime ?? 999))[0] || null;
}

// "다른 노선 보기"용 — 소요시간 오름차순으로 상위 N개 후보를 그대로 돌려줍니다
// (ODsay가 이미 서로 다른 경로 조합으로 후보를 나눠서 주기 때문에 별도
// 중복 제거는 하지 않음).
export function pickRoutes(paths, limit = 3) {
  return [...paths].sort((a, b) => (a.info?.totalTime ?? 999) - (b.info?.totalTime ?? 999)).slice(0, limit);
}

// 지하철은 lane[0].name(예: "수도권 2호선"), 버스는 lane[0].busNo(예: "341")에
// 노선 식별자가 들어있음 — 필드명이 서로 달라서 trafficType별로 나눠서 읽습니다.
function laneLabel(sp) {
  const lane = sp.lane && sp.lane[0];
  if (!lane) return '';
  if (sp.trafficType === 2) return lane.busNo ? `${lane.busNo}번` : '';
  return lane.name || '';
}

// subPath를 순서 그대로 훑으면서 도보/지하철/버스 구간을 뽑아냅니다(합치지
// 않음 — 실제로 걷고 타는 순서 그대로라야 각 구간의 도착 예정 시각을
// 클라이언트에서 정확히 계산할 수 있음). 화면에는 이 순서대로 보여주고,
// 지하철/버스 구간에만 "몇 시 몇 분 도착" 같은 예상 시각을 붙입니다(도보는
// 굳이 시각을 안 보여줘도 되는 정보라 소요시간만).
export function structureRoute(path) {
  if (!path) return null;
  const subPaths = path.subPath || [];
  const segments = [];
  for (const sp of subPaths) {
    if (sp.trafficType === 3) {
      if (sp.sectionTime) segments.push({ type: 'walk', label: `도보 ${sp.sectionTime}분`, minutes: sp.sectionTime });
    } else if (sp.trafficType === 1 || sp.trafficType === 2) {
      const modeLabel = sp.trafficType === 1 ? '지하철' : '버스';
      const laneName = laneLabel(sp);
      segments.push({
        type: sp.trafficType === 1 ? 'subway' : 'bus',
        label: `${modeLabel}${laneName ? ' ' + laneName : ''} ${sp.sectionTime}분`,
        minutes: sp.sectionTime || 0,
      });
    }
  }
  const totalMinutes = path.info?.totalTime ?? segments.reduce((s, x) => s + x.minutes, 0);
  return { segments, totalMinutes };
}
