// 대중교통 길찾기 — 카카오 로컬 API(장소 이름 → 좌표, 지오코딩) + ODsay API
// (좌표 두 개 → 실제 버스/지하철 최적 경로)를 조합합니다. api/transit-route.js가
// 이 결과를 그대로 JSON으로 클라이언트에 돌려주고, 클라이언트는 AI를 거치지
// 않고 카드로 바로 렌더링합니다 — 텍스트 나열보다 훨씬 간결하고, 경로/시간을
// AI가 지어낼 여지 자체가 없습니다.
//
// 환경변수 2개가 필요합니다:
// - KAKAO_REST_API_KEY: https://developers.kakao.com → 애플리케이션 추가 → REST API 키
// - ODSAY_API_KEY: https://lab.odsay.com → 회원가입 → 애플리케이션 등록 →
//   **Server** API 키 (Web 키 아님 — 서버에서 호출하므로 Server 키가 필요합니다)
// 둘 중 하나라도 없거나 API 호출이 실패하면 null을 반환하고, 호출부가 "못
// 찾았다"고 안내하도록 넘깁니다 — 절대 조용히 틀린 값을 만들어내지 않습니다.

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

export async function searchTransitRoutes({ startLat, startLng, endLat, endLng }) {
  const key = process.env.ODSAY_API_KEY;
  if (!key) return { paths: null, debug: 'no ODSAY_API_KEY set' };
  try {
    const params = new URLSearchParams({
      apiKey: key,
      SX: String(startLng), SY: String(startLat),
      EX: String(endLng), EY: String(endLat),
    });
    const response = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${params.toString()}`);
    const data = await response.json().catch(() => null);
    if (!response.ok) return { paths: null, debug: `http ${response.status}: ${JSON.stringify(data)}` };
    const paths = data?.result?.path;
    if (!Array.isArray(paths) || !paths.length) return { paths: null, debug: JSON.stringify(data) };
    return { paths, debug: null };
  } catch (e) {
    return { paths: null, debug: `exception: ${e.message}` };
  }
}

// 소요시간이 가장 짧은 경로 하나만 고릅니다 — 버스/지하철 선호를 더는 물어보지
// 않기로 해서(그 질문 자체를 없앰), 그냥 최적 경로 하나로 단순화.
export function pickBestRoute(paths) {
  return [...paths].sort((a, b) => (a.info?.totalTime ?? 999) - (b.info?.totalTime ?? 999))[0] || null;
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
