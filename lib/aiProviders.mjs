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
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini API 호출 실패 (status ${response.status})`);
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').join('');
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
