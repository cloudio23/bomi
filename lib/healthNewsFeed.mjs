// 매일의 "최신 건강/의료 주제" 후보를 실제 뉴스 RSS에서 가져옵니다.
// (창업자가 "AI가 그냥 지어내는 주제 말고 실제 뉴스/RSS 기반으로 선정" 결정)
//
// fast-xml-parser 같은 전용 파서 없이 정규식으로 직접 파싱합니다 — RSS 2.0
// <item> 구조가 단순하고 예측 가능해서, aiProviders.mjs/supabaseAdmin.mjs와
// 같은 "무의존성 fetch 스타일"을 유지하려는 의도적 선택입니다.
//
// 소스 선정 근거(2026-08-01 직접 curl로 검증):
// - kormedi.com/feed/: 코메디닷컴, 일반 대중 대상 건강 정보 전문 매체 — 1차 소스.
// - mdtoday.co.kr: 메디컬투데이, 종합 매체라 스포츠/연예 기사도 섞여 있어서
//   HEALTH_KEYWORDS로 걸러서 보조 소스로만 씀.
// health.chosun.com, hidoc.co.kr, yakup.com, kdca.go.kr 등은 RSS 자체가 404라 제외함.
const FEEDS = [
  { url: 'https://kormedi.com/feed/', name: '코메디닷컴', requireKeywordFilter: false },
  { url: 'https://www.mdtoday.co.kr/rss/allArticle.xml', name: '메디컬투데이', requireKeywordFilter: true },
];

const HEALTH_KEYWORDS = [
  '건강', '질환', '질병', '증상', '치료', '진단', '병원', '의사', '약', '영양', '식단',
  '운동', '수면', '혈압', '혈당', '콜레스테롤', '암', '심장', '뇌', '관절', '통증',
  '다이어트', '비만', '노화', '치매', '백신', '감염', '스트레스', '정신건강', '눈', '피부',
];

function stripCdata(text) {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(text || '');
  return m ? m[1] : (text || '');
}

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function extractTag(itemXml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(itemXml);
  if (!m) return '';
  return stripHtml(stripCdata(m[1])).trim();
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item[\s\S]*?>[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) || [];
  for (const itemXml of matches) {
    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link');
    const description = extractTag(itemXml, 'description');
    const pubDate = extractTag(itemXml, 'pubDate');
    if (title && link) items.push({ title, link, description, pubDate });
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BomiCardnewsBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    let items = parseRssItems(xml);
    if (feed.requireKeywordFilter) {
      items = items.filter(it => HEALTH_KEYWORDS.some(kw => it.title.includes(kw) || it.description.includes(kw)));
    }
    return items.map(it => ({ ...it, source: feed.name }));
  } catch {
    // 개별 피드 하나가 죽어도(사이트 점검 등) 나머지 소스로 계속 진행합니다.
    return [];
  }
}

// excludeLinks: 최근 게시/검토했던 원문 링크 목록(Supabase에서 조회) — 같은
// 기사를 반복해서 카드뉴스로 만들지 않도록 걸러냅니다.
export async function fetchHealthTopicCandidates(excludeLinks = new Set(), limit = 8) {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const seen = new Set();
  const candidates = [];
  for (const item of results.flat()) {
    if (excludeLinks.has(item.link) || seen.has(item.link)) continue;
    seen.add(item.link);
    candidates.push(item);
  }
  return candidates.slice(0, limit);
}
