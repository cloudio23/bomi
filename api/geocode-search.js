// 출발지/도착지 입력창의 자동완성 검색용 — 카카오 로컬 키워드 검색 결과를
// 여러 개(최대 5개) 그대로 클라이언트에 전달합니다. lib/transit.mjs의
// geocodePlace()는 첫 결과 하나만 골라서 경로 조회에 쓰는 용도라 이거와는
// 다릅니다(사용자가 직접 정확한 장소를 고르게 하는 게 목적).
//
// 자동완성은 "있으면 좋고 없어도 그만"인 기능이라, 키가 없거나 호출이
// 실패해도 에러를 내지 않고 빈 목록을 돌려줍니다 — 입력 경험 자체를
// 깨뜨리지 않기 위함.
export default async function handler(req, res) {
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
