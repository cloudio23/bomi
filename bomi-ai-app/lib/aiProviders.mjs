// Shared AI provider abstraction for Bomi AI.
//
// Used by both api/chat.js (Vercel serverless function, production) and the
// qa/ test harness — so QA always exercises the same provider logic
// production uses instead of a re-implemented copy that can drift.
//
// AI_PROVIDER env var picks the backend ("gemini" default, or
// "anthropic"/"claude"). This is a DELIBERATE MANUAL switch, not automatic
// fallback: if Gemini's free tier rate-limits or errors, we surface a plain
// "잠시 후 다시 시도해 주세요" error rather than silently routing to Claude,
// so nobody gets a surprise Anthropic bill because Gemini hiccuped for an
// hour. The founder flips AI_PROVIDER to "anthropic" deliberately once
// Gemini's free tier genuinely isn't enough anymore.
//
// Verify GEMINI_MODEL against Google AI Studio's current free-tier model
// list before relying on it in production — model names/quotas change; this
// default is a starting point, not a guarantee.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

export function currentProvider() {
  return (process.env.AI_PROVIDER || 'gemini').toLowerCase();
}

export async function callAI(system, messages, { maxTokens = 500 } = {}) {
  const provider = currentProvider();
  if (provider === 'anthropic' || provider === 'claude') {
    return callClaude(system, messages, maxTokens);
  }
  return callGemini(system, messages, maxTokens);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Google 검색 그라운딩은 실제로 트리거됐을 때 건당 $0.035(1,000건당 $35)로,
// 일반 토큰 비용의 수십 배입니다. Gemini 2.x의 현재 google_search 툴은(예전
// google_search_retrieval의 dynamic_retrieval_config/dynamic_threshold 같은
// 조절 파라미터가 없어짐 — 2026-08 기준 공식 문서 확인) 모델이 알아서
// 검색 여부를 판단하긴 하지만, 애초에 그라운딩이 필요 없는 요청(안부,
// 체크리스트, 말벗, 사주 등)에서는 tools 자체를 아예 안 보내는 게 더
// 확실하고 저렴합니다 — systemPrompt()가 실제로 실시간 정보를 요구하는
// 주제로 구분해둔 것과 같은 카테고리를 그대로 반영했습니다.
const GROUNDING_KEYWORDS = /날씨|기온|미세먼지|강수|자외선|황사|뉴스|시사|경기|경제|부동산|정책|정치|금리|물가|환율|연예|민원|주가|주식|시세|종목|코스피|코스닥/;
function needsGrounding(text) {
  return GROUNDING_KEYWORDS.test(text || '');
}

// 무료 티어의 진짜 병목은 하루 총량이 아니라 분당 10건(RPM)이라, 어르신 여러
// 명이 같은 순간에 몰리면 하루 목표치가 한참 남았어도 바로 429가 납니다.
// 이건 "진짜 하루 할당량 소진"이 아니라 "그 1분"의 일시적 혼잡이라 짧게
// 재시도하면 대부분 다음 1분 창에서 성공합니다 — provider 전환(Claude)이
// 아니라 같은 Gemini 안에서의 재시도라 예상치 못한 과금 걱정은 없어요.
const GEMINI_RETRY_DELAYS_MS = [1200, 2500];

async function callGemini(system, messages, maxTokens) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않아요. Google AI Studio에서 무료 API 키를 발급받아 환경변수로 등록해 주세요.');
  }
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  // 날씨/뉴스/민원/주식처럼 실시간 정보가 실제로 필요한 요청에서만 그라운딩
  // 툴을 붙입니다 — 나머지(안부, 체크리스트, 말벗, 사주 등)는 tools 없이
  // 호출해서 불필요한 그라운딩 과금을 원천 차단합니다.
  const lastUserText = messages.length ? messages[messages.length - 1].content : '';
  const grounding = needsGrounding(lastUserText);
  const body = JSON.stringify({
    ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
    contents,
    // 실시간 구글 검색으로 답을 보강 (버스/지하철 경로, 최신 정보 등 정확도 향상).
    // 예전 배포 버전(하이브리드 provider 리팩터 이전)에 있던 기능인데 리팩터
    // 과정에서 빠졌던 걸 복원함 — thinkingBudget:0은 "생각하는" 토큰을 꺼서
    // 답변이 중간에 잘리지 않게 하기 위함.
    ...(grounding ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
  });

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    });
    if (response.ok) {
      const data = await response.json();
      // 실제 원가 추적용 — Vercel 함수 로그에서 "요청함=true인데 실제사용=false"
      // 비율이나 이번 달 그라운딩 호출 총량을 눈으로 확인할 수 있습니다.
      const grounded = !!(data?.candidates?.[0]?.groundingMetadata);
      console.log(`[gemini-grounding] requested=${grounding} used=${grounded}`);
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text || '').join('');
    }
    const data = await response.json().catch(() => ({}));
    const error = new Error(data?.error?.message || `Gemini API 호출 실패 (status ${response.status})`);
    const canRetry = response.status === 429 && attempt < GEMINI_RETRY_DELAYS_MS.length;
    if (!canRetry) throw error;
    await sleep(GEMINI_RETRY_DELAYS_MS[attempt]);
  }
}

async function callClaude(system, messages, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY가 설정되어 있지 않아요. AI_PROVIDER=anthropic으로 전환하려면 이 키가 필요해요.');
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system: system || '', messages }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic API 호출 실패 (status ${response.status})`);
  }
  const textBlock = (data.content || []).find(c => c.type === 'text');
  return textBlock ? textBlock.text : '';
}
