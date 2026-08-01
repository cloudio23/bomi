// 대중교통 길찾기 결과를 AI를 거치지 않고 그대로 JSON으로 돌려줍니다.
// (예전엔 이 결과를 system 프롬프트에 넣어 AI가 문장으로 풀어 설명했는데,
// 그러면 아무리 짧게 써도 "글로 나열하는" 느낌이 나서, 클라이언트가 카드
// 형태로 직접 그리도록 바꿨습니다 — 계산도 서술도 필요 없이 사실만 전달.)
import { resolvePlace, searchTransitRoutes, pickBestRoute, structureRoute } from '../lib/transit.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' });
    return;
  }
  try {
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
  } catch (e) {
    res.status(500).json({ ok: false, message: '경로를 확인하는 중 문제가 생겼어요.' });
  }
}
