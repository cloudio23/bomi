// 위치 관련 엔드포인트 2개를 하나로 합쳤습니다(Vercel Hobby 플랜의 서버리스
// 함수 12개 한도 때문 — 2026-08-02 QA 감사에서 여유가 0개인 걸 발견).
// ?action= 쿼리 파라미터로 구분하며, 각 액션의 동작은 예전 파일
// (geocode-search.js / transit-route.js)과 완전히 동일합니다:
//
// - GET  ?action=search&query=...   → 장소 자동완성 검색 (카카오 로컬)
// - POST ?action=route   {origin, destination}  → 대중교통 경로 (카카오+ODsay)
import { resolvePlace, searchTransitRoutes, pickBestRoute, structureRoute } from '../lib/transit.mjs';

// 출발지/도착지 입력창의 자동완성 검색용 — 카카오 로컬 키워드 검색 결과를
// 여러 개(최대 5개) 그대로 클라이언트에 전달합니다. lib/transit.mjs의
// geocodePlace()는 첫 결과 하나만 골라서 경로 조회에 쓰는 용도라 이거와는
// 다릅니다(사용자가 직접 정확한 장소를 고르게 하는 게 목적).
//
// 자동완성은 "있으면 좋고 없어도 그만"인 기능이라, 키가 없거나 호출이
// 실패해도 에러를 내지 않고 빈 목록을 돌려줍니다 — 입력 경험 자체를
// 깨뜨리지 않기 위함.
async function handleSearch(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  const query = ((req.query && req.query.query) || '').trim();
  if (!query) {
    res.status(200).json({ results: [] });
    return;
  }
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    res.status(200).json({ results: [] });
    return;
  }
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=5`;
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!response.ok) {
      res.status(200).json({ results: [] });
      return;
    }
    const data = await response.json();
    const results = (data.documents || []).map(d => ({
      placeName: d.place_name,
      address: d.road_address_name || d.address_name || '',
      lat: Number(d.y),
      lng: Number(d.x),
    }));
    res.status(200).json({ results });
  } catch (e) {
    res.status(200).json({ results: [] });
  }
}

// 대중교통 길찾기 결과를 AI를 거치지 않고 그대로 JSON으로 돌려줍니다.
// (예전엔 이 결과를 system 프롬프트에 넣어 AI가 문장으로 풀어 설명했는데,
// 그러면 아무리 짧게 써도 "글로 나열하는" 느낌이 나서, 클라이언트가 카드
// 형태로 직접 그리도록 바꿨습니다 — 계산도 서술도 필요 없이 사실만 전달.)
async function handleRoute(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' });
    return;
  }
  const { origin, destination } = req.body || {};
  if (!origin || !destination) {
    res.status(400).json({ ok: false, message: '출발지와 도착지가 필요해요.' });
    return;
  }

  const originPlace = await resolvePlace(origin);
  if (!originPlace) {
    res.status(200).json({ ok: false, message: `"${origin.text || '출발지'}" 위치를 찾지 못했어요. 조금 더 구체적으로 입력해주시겠어요?` });
    return;
  }

  const destPlace = await resolvePlace(destination);
  if (!destPlace) {
    res.status(200).json({ ok: false, message: `"${destination.text || '목적지'}" 위치를 찾지 못했어요. 조금 더 구체적으로 입력해주시겠어요?` });
    return;
  }

  const routeResult = await searchTransitRoutes({
    startLat: originPlace.lat, startLng: originPlace.lng,
    endLat: destPlace.lat, endLng: destPlace.lng,
  });
  const paths = routeResult.paths;
  if (!paths) {
    res.status(200).json({ ok: false, message: '대중교통 경로를 찾지 못했어요.', _debug: routeResult.debug });
    return;
  }

  const best = pickBestRoute(paths);
  const structured = structureRoute(best);
  res.status(200).json({
    ok: true,
    origin: { placeName: originPlace.placeName },
    destination: { placeName: destPlace.placeName },
    segments: structured.segments,
    totalMinutes: structured.totalMinutes,
  });
}

export default async function handler(req, res) {
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'search') return await handleSearch(req, res);
    if (action === 'route') return await handleRoute(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요 (search | route).' });
  } catch (e) {
    res.status(500).json({ ok: false, message: '요청 처리 중 문제가 생겼어요.' });
  }
}
