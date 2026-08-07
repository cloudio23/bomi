// 위치 관련 엔드포인트 2개를 하나로 합쳤습니다(Vercel Hobby 플랜의 서버리스
// 함수 12개 한도 때문 — 2026-08-02 QA 감사에서 여유가 0개인 걸 발견).
// ?action= 쿼리 파라미터로 구분하며, 각 액션의 동작은 예전 파일
// (geocode-search.js / transit-route.js)과 완전히 동일합니다:
//
// - GET  ?action=search&query=...   → 장소 자동완성 검색 (카카오 로컬)
// - POST ?action=route   {origin, destination}  → 대중교통 경로 (카카오+ODsay)
// - GET  ?action=restaurants&lat=&lng=  → 주변 음식점 추천 (카카오 로컬 카테고리 검색)
import { resolvePlace, searchTransitRoutes, pickRoutes, structureRoute } from '../lib/transit.mjs';

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

  const paths = await searchTransitRoutes({
    startLat: originPlace.lat, startLng: originPlace.lng,
    endLat: destPlace.lat, endLng: destPlace.lng,
  });
  if (!paths) {
    res.status(200).json({ ok: false, message: '대중교통 경로를 찾지 못했어요.' });
    return;
  }

  // 소요시간 기준 상위 3개 후보를 모두 구조화해서 돌려줍니다 — 화면엔 가장
  // 빠른 것(routes[0])을 기본으로 보여주고, "다른 노선 보기"에서 나머지를
  // 고를 수 있게 합니다.
  const routes = pickRoutes(paths, 3).map(p => structureRoute(p));
  const best = routes[0];
  res.status(200).json({
    ok: true,
    origin: { placeName: originPlace.placeName, lat: originPlace.lat, lng: originPlace.lng },
    destination: { placeName: destPlace.placeName, lat: destPlace.lat, lng: destPlace.lng },
    segments: best.segments,
    totalMinutes: best.totalMinutes,
    routes,
  });
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// 주변 맛집 추천 — 카카오/네이버 로컬 검색은 리뷰 수·평점 데이터 자체를 안 줘서
// (확인 완료), 리뷰 수 조건으로 추리려면 구글 Places API(New)가 사실상
// 유일한 선택지입니다. AI가 맛집을 지어내지 않도록 이것도 대중교통/주식처럼
// AI를 거치지 않고 실제 데이터를 그대로 카드로 보여줍니다.
//
// 리뷰 수(0~1000)·거리(1~100km)·음식 카테고리는 화면의 사이드 드래그/버튼으로
// 사용자가 직접 고릅니다(index.html의 addRestaurantFilterCard 참고).
const DEFAULT_MIN_REVIEWS = 500;
const DEFAULT_RADIUS_KM = 2;
// 구글 Places API(New) Nearby Search의 radius 필드는 최대 50,000m(50km)까지만
// 허용됩니다 — 화면 슬라이더는 100km까지 있지만(사용자 요청), 그보다 크게
// 보내면 API가 에러를 내서 여기서 50km로 자릅니다.
const GOOGLE_NEARBY_MAX_RADIUS_M = 50000;
// 구글 Places API(New)엔 "양식"에 정확히 대응하는 단일 타입이 없어서, 서양
// 요리로 분류되는 대표 타입 몇 개를 묶어서 근사합니다.
const CATEGORY_TYPES = {
  korean: ['korean_restaurant'],
  chinese: ['chinese_restaurant'],
  japanese: ['japanese_restaurant'],
  western: ['american_restaurant', 'italian_restaurant', 'french_restaurant', 'steak_house'],
};

async function handleRestaurants(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' });
    return;
  }
  const lat = Number(req.query && req.query.lat);
  const lng = Number(req.query && req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ ok: false, message: '위치 정보(lat, lng)가 필요해요.' });
    return;
  }
  const minReviewsRaw = req.query && req.query.minReviews;
  const minReviews = minReviewsRaw === undefined ? DEFAULT_MIN_REVIEWS : Math.max(0, Number(minReviewsRaw) || 0);
  const radiusKmRequested = Number(req.query && req.query.radiusKm) || DEFAULT_RADIUS_KM;
  const radiusM = Math.min(Math.max(radiusKmRequested, 1) * 1000, GOOGLE_NEARBY_MAX_RADIUS_M);
  const category = (req.query && req.query.category) || 'all';
  const includedTypes = CATEGORY_TYPES[category] || ['restaurant'];

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    res.status(200).json({ ok: false, message: '맛집 정보를 가져오지 못했어요.' });
    return;
  }
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.formattedAddress,places.location,places.googleMapsUri,places.primaryTypeDisplayName',
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
        languageCode: 'ko',
        rankPreference: 'POPULARITY',
      }),
    });
    if (!response.ok) {
      res.status(200).json({ ok: false, message: '맛집 정보를 가져오지 못했어요.' });
      return;
    }
    const data = await response.json();
    const places = data.places || [];
    // 리뷰 수로 먼저 거르고, 그 안에서는 구글이 이미 인기순(POPULARITY)으로
    // 정렬해서 준 순서를 그대로 씁니다. 최대 10개까지만 노출.
    const qualified = places.filter(p => (p.userRatingCount || 0) >= minReviews).slice(0, 10);
    if (!qualified.length) {
      res.status(200).json({ ok: false, message: '조건에 맞는 맛집을 찾지 못했어요. 조건을 조금 넓혀서 다시 찾아볼까요?' });
      return;
    }
    const results = qualified.map(p => ({
      name: (p.displayName && p.displayName.text) || '',
      category: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
      rating: p.rating != null ? p.rating : null,
      reviewCount: p.userRatingCount || 0,
      address: p.formattedAddress || '',
      distance: p.location ? haversineMeters(lat, lng, p.location.latitude, p.location.longitude) : null,
      mapsUrl: p.googleMapsUri || '',
    }));
    res.status(200).json({ ok: true, results, filters: { minReviews, radiusKm: radiusM / 1000, category } });
  } catch (e) {
    res.status(200).json({ ok: false, message: '맛집 정보를 가져오는 중 문제가 생겼어요.' });
  }
}

export default async function handler(req, res) {
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'search') return await handleSearch(req, res);
    if (action === 'route') return await handleRoute(req, res);
    if (action === 'restaurants') return await handleRestaurants(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요 (search | route | restaurants).' });
  } catch (e) {
    res.status(500).json({ ok: false, message: '요청 처리 중 문제가 생겼어요.' });
  }
}
