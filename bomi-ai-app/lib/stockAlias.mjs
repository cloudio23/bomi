// "테슬라"처럼 한글 이름으로 물어봐도 미국 주식 티커(TSLA)를 알아듣게 해주는
// 표 — Finnhub 등 미국 주식 API는 티커/영문명으로만 검색되고 한글은 못 알아듣기
// 때문에, 어르신들이 실제로 물어볼 법한 유명 미국 기업 위주로 직접 정리했습니다.
// 완전한 목록이 아니라 자주 찾는 종목 위주이며, 여기 없는 이름은 영문 티커를
// 직접 입력하거나 국내 종목명 검색으로 넘어갑니다.
export const US_STOCK_ALIASES = {
  '테슬라': { ticker: 'TSLA', name: '테슬라' },
  '애플': { ticker: 'AAPL', name: '애플' },
  '구글': { ticker: 'GOOGL', name: '구글(알파벳)' },
  '알파벳': { ticker: 'GOOGL', name: '구글(알파벳)' },
  '아마존': { ticker: 'AMZN', name: '아마존' },
  '마이크로소프트': { ticker: 'MSFT', name: '마이크로소프트' },
  '엔비디아': { ticker: 'NVDA', name: '엔비디아' },
  '메타': { ticker: 'META', name: '메타(페이스북)' },
  '페이스북': { ticker: 'META', name: '메타(페이스북)' },
  '넷플릭스': { ticker: 'NFLX', name: '넷플릭스' },
  '디즈니': { ticker: 'DIS', name: '디즈니' },
  '월마트': { ticker: 'WMT', name: '월마트' },
  '코카콜라': { ticker: 'KO', name: '코카콜라' },
  '스타벅스': { ticker: 'SBUX', name: '스타벅스' },
  '나이키': { ticker: 'NKE', name: '나이키' },
  '맥도날드': { ticker: 'MCD', name: '맥도날드' },
  '비자': { ticker: 'V', name: '비자' },
  '마스터카드': { ticker: 'MA', name: '마스터카드' },
  '보잉': { ticker: 'BA', name: '보잉' },
  '인텔': { ticker: 'INTC', name: '인텔' },
  '퀄컴': { ticker: 'QCOM', name: '퀄컴' },
  'AMD': { ticker: 'AMD', name: 'AMD' },
  '어도비': { ticker: 'ADBE', name: '어도비' },
  '오라클': { ticker: 'ORCL', name: '오라클' },
  '세일즈포스': { ticker: 'CRM', name: '세일즈포스' },
  '페이팔': { ticker: 'PYPL', name: '페이팔' },
  '우버': { ticker: 'UBER', name: '우버' },
  '리비안': { ticker: 'RIVN', name: '리비안' },
  '팔란티어': { ticker: 'PLTR', name: '팔란티어' },
  '버크셔': { ticker: 'BRK.B', name: '버크셔 해서웨이' },
  '버크셔해서웨이': { ticker: 'BRK.B', name: '버크셔 해서웨이' },
  'JP모건': { ticker: 'JPM', name: 'JP모건' },
  '뱅크오브아메리카': { ticker: 'BAC', name: '뱅크오브아메리카' },
  '존슨앤존슨': { ticker: 'JNJ', name: '존슨앤존슨' },
  '화이자': { ticker: 'PFE', name: '화이자' },
  '펩시': { ticker: 'PEP', name: '펩시코' },
  '어도비시스템즈': { ticker: 'ADBE', name: '어도비' },
  '시스코': { ticker: 'CSCO', name: '시스코' },
  '아이비엠': { ticker: 'IBM', name: 'IBM' },
  'IBM': { ticker: 'IBM', name: 'IBM' },
};

// 이미 영문 티커(대문자 1~5자, 점 포함 가능: BRK.B 등)처럼 보이면 그대로 미국
// 주식으로 취급합니다.
export function looksLikeUsTicker(query) {
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(query.trim());
}

export function resolveUsAlias(query) {
  const trimmed = query.trim();
  if (US_STOCK_ALIASES[trimmed]) return US_STOCK_ALIASES[trimmed];
  const upper = trimmed.toUpperCase();
  if (looksLikeUsTicker(upper)) return { ticker: upper, name: upper };
  return null;
}

// 자동완성용 — 입력 중인 글자가 한글 별칭 안에 포함되거나 티커 앞부분과
// 일치하면 후보로 보여줍니다(완전 일치가 아니어도 타이핑 중에 바로 뜨도록).
export function searchUsAliases(query, limit) {
  limit = limit || 5;
  const trimmed = query.trim();
  if (!trimmed) return [];
  const upper = trimmed.toUpperCase();
  const seen = new Set();
  const results = [];
  for (const [key, val] of Object.entries(US_STOCK_ALIASES)) {
    if (seen.has(val.ticker)) continue;
    if (key.includes(trimmed) || val.ticker.startsWith(upper)) {
      results.push({ name: val.name, ticker: val.ticker });
      seen.add(val.ticker);
      if (results.length >= limit) break;
    }
  }
  return results;
}
