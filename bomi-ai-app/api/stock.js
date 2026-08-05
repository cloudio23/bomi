// 주식 시세 조회 — 국내 종목은 공공데이터포털(금융위원회_주식시세정보, 한국거래소
// 데이터)에서, 미국 종목은 Finnhub에서 가져옵니다. 둘 다 실제 데이터만 쓰고,
// AI가 시세나 등락률을 지어내는 일은 절대 없습니다(못 찾으면 못 찾았다고 안내).
//
// 국내 API는 실시간이 아니라 하루 1회(전 영업일 오후 1시 이후) 갱신되는 종가
// 기준 데이터입니다 — "전일 대비 등락"을 물어보는 용도에는 이 정도로 충분합니다.
//
// 환경변수:
// - DATA_GO_KR_STOCK_KEY: data.go.kr → "금융위원회_주식시세정보" 활용신청 →
//   마이페이지 개발계정 상세보기의 일반 인증키(Decoding 값 그대로, URL 인코딩된
//   문자열이 아니라 원본 키를 저장 — 여기서 URLSearchParams가 알아서 인코딩함)
// - FINNHUB_API_KEY: finnhub.io 무료 가입 후 대시보드에 뜨는 API Key
//
// - GET ?action=search&query=...             → 종목명/티커로 후보 하나 찾기
// - GET ?action=suggest&query=...            → 입력 중 자동완성 후보 목록
// - GET ?action=quote&market=KR|US&code=...   → 실제 시세(종가/등락/등락률) 조회
import { resolveUsAlias, searchUsAliases } from '../lib/stockAlias.mjs';

const KR_STOCK_ENDPOINT = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';

function formatBasDt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// 최근 N일 범위로 조회해서, 그 중 가장 최신 기준일(basDt)의 데이터만 골라냅니다
// (주말/공휴일엔 데이터가 없어서 "오늘" 하루만 조회하면 자주 빈 결과가 옵니다).
async function fetchKrRows({ likeItmsNm, srtnCd }) {
  const key = process.env.DATA_GO_KR_STOCK_KEY;
  if (!key) return null;
  const end = new Date();
  const begin = new Date();
  begin.setDate(begin.getDate() - 10);
  const params = new URLSearchParams({
    serviceKey: key,
    resultType: 'json',
    numOfRows: '50',
    pageNo: '1',
    beginBasDt: formatBasDt(begin),
    endBasDt: formatBasDt(end),
  });
  if (likeItmsNm) params.set('likeItmsNm', likeItmsNm);
  if (srtnCd) params.set('srtnCd', srtnCd);
  try {
    const response = await fetch(`${KR_STOCK_ENDPOINT}?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    const items = data?.response?.body?.items?.item;
    if (!items) return null;
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    return null;
  }
}

// 같은 종목이 여러 날짜로 여러 건 올 수 있어서, 종목코드별로 가장 최신 basDt인
// 것 하나만 남깁니다.
function latestPerStock(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const existing = byCode.get(row.srtnCd);
    if (!existing || row.basDt > existing.basDt) byCode.set(row.srtnCd, row);
  }
  return [...byCode.values()];
}

async function handleSearch(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' });
    return;
  }
  const query = ((req.query && req.query.query) || '').trim();
  if (!query) {
    res.status(200).json({ ok: false, message: '종목명이나 티커를 알려주세요.' });
    return;
  }

  // 1) 미국 종목 한글 별칭(테슬라 등) 또는 영문 티커로 보이는 경우
  const usAlias = resolveUsAlias(query);
  if (usAlias) {
    res.status(200).json({ ok: true, market: 'US', code: usAlias.ticker, name: usAlias.name });
    return;
  }

  // 2) 국내 종목명 검색 (부분일치)
  const rows = await fetchKrRows({ likeItmsNm: query });
  if (!rows || !rows.length) {
    res.status(200).json({ ok: false, message: `"${query}" 종목을 찾지 못했어요. 정확한 종목명이나 티커로 다시 말씀해주시겠어요?` });
    return;
  }
  const candidates = latestPerStock(rows);
  // 이름이 정확히 같은 게 있으면 그걸 우선, 없으면 첫 번째 후보
  const exact = candidates.find(c => c.itmsNm === query);
  const best = exact || candidates[0];
  res.status(200).json({ ok: true, market: 'KR', code: best.srtnCd, name: best.itmsNm });
}

// 검색 확인 절차 없이 입력 중에 바로 후보를 보여주는 자동완성 — 국내는
// 종목명 부분일치(공공데이터포털), 해외는 한글 별칭/티커 부분일치를 함께 보여줍니다.
async function handleSuggest(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' });
    return;
  }
  const query = ((req.query && req.query.query) || '').trim();
  if (!query) {
    res.status(200).json({ ok: true, results: [] });
    return;
  }

  const usMatches = searchUsAliases(query, 5).map(m => ({ market: 'US', code: m.ticker, name: m.name }));

  let krMatches = [];
  const rows = await fetchKrRows({ likeItmsNm: query });
  if (rows && rows.length) {
    krMatches = latestPerStock(rows).slice(0, 6).map(r => ({ market: 'KR', code: r.srtnCd, name: r.itmsNm }));
  }

  res.status(200).json({ ok: true, results: [...krMatches, ...usMatches].slice(0, 8) });
}

async function handleQuote(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' });
    return;
  }
  const market = (req.query && req.query.market) || '';
  const code = ((req.query && req.query.code) || '').trim();
  if (!code || (market !== 'KR' && market !== 'US')) {
    res.status(400).json({ ok: false, message: 'market(KR|US)과 code가 필요해요.' });
    return;
  }

  if (market === 'KR') {
    const rows = await fetchKrRows({ srtnCd: code });
    if (!rows || !rows.length) {
      res.status(200).json({ ok: false, message: '시세를 확인하지 못했어요.' });
      return;
    }
    const latest = latestPerStock(rows)[0];
    res.status(200).json({
      ok: true, market: 'KR', name: latest.itmsNm, code: latest.srtnCd,
      price: Number(latest.clpr), change: Number(latest.vs), changePercent: Number(latest.fltRt),
      asOfDate: latest.basDt,
    });
    return;
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (!finnhubKey) {
    res.status(200).json({ ok: false, message: '시세를 확인하지 못했어요.' });
    return;
  }
  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(code)}&token=${finnhubKey}`);
    if (!response.ok) {
      res.status(200).json({ ok: false, message: '시세를 확인하지 못했어요.' });
      return;
    }
    const data = await response.json();
    // Finnhub는 존재하지 않는 티커에도 200과 함께 전부 0인 응답을 주는 경우가
    // 있어서, 현재가가 0이면 못 찾은 것으로 취급합니다.
    if (!data || !data.c) {
      res.status(200).json({ ok: false, message: '시세를 확인하지 못했어요.' });
      return;
    }
    res.status(200).json({
      ok: true, market: 'US', name: code, code,
      price: data.c, change: data.d, changePercent: data.dp, asOfDate: null,
    });
  } catch (e) {
    res.status(200).json({ ok: false, message: '시세를 확인하지 못했어요.' });
  }
}

export default async function handler(req, res) {
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'search') return await handleSearch(req, res);
    if (action === 'suggest') return await handleSuggest(req, res);
    if (action === 'quote') return await handleQuote(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요 (search | suggest | quote).' });
  } catch (e) {
    res.status(500).json({ ok: false, message: '요청 처리 중 문제가 생겼어요.' });
  }
}
