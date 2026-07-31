// Thin QA wrapper around the shared ../../lib/aiProviders.mjs — so the
// harness always exercises the exact same provider logic production uses
// (Gemini by default, Claude via AI_PROVIDER=anthropic) instead of a
// separately-maintained copy that can drift out of sync.

import { callAI, currentProvider } from '../../lib/aiProviders.mjs';

export async function callBomiApi(system, messages, opts = {}) {
  if (process.env.QA_MOCK === '1') {
    return mockReply(system, messages);
  }
  return callAI(system, messages, opts);
}

export { currentProvider };

// Canned deterministic replies so persona/scenario/report wiring can be
// smoke-tested with no API key and no cost. Never trust QA_MOCK=1 scores as
// real QA verdicts — they only prove the harness runs end-to-end.
function mockReply(system, messages) {
  const isJudge = typeof system === 'string' && system.includes('QA 심사관');
  if (isJudge) {
    const isGreetingJudge = system.includes('서로 다른 날 아침');
    if (isGreetingJudge) {
      return JSON.stringify({ score: 2, reason: '[MOCK] 세 응답이 비슷한 문장 구조를 반복함(가짜 데이터, 실제 판정 아님).' });
    }
    return JSON.stringify({
      scores: {
        zero_ui: { score: 4, reason: '[MOCK] 목업 채점' },
        readability: { score: 4, reason: '[MOCK] 목업 채점' },
        warmth_persona: { score: 4, reason: '[MOCK] 목업 채점' },
        medical_safety: { score: 5, reason: '[MOCK] 목업 채점' },
        reminder_accuracy: { score: 4, reason: '[MOCK] 목업 채점' },
        patience_on_repeat: { score: 4, reason: '[MOCK] 목업 채점' },
        topic_neutrality: { score: 5, reason: '[MOCK] 목업 채점' },
      },
      flagged_quotes: [],
    });
  }
  const last = messages[messages.length - 1]?.content || '';
  if (/약.*(먹었|드셨)/.test(last)) {
    return '[MOCK] 확인해보니 오늘 아침 약은 이미 챙겨 드셨어요! 점심은 아직이니 이따 잊지 말고 챙겨 드세요 😊';
  }
  if (/외롭|힘들|답답/.test(last)) {
    return '[MOCK] 그런 마음 드실 때 저한테 편하게 말씀해 주세요. 오늘 하루는 좀 어떠셨어요?';
  }
  if (/버스|시간표/.test(last)) {
    return '[MOCK] 정류장 이름만 말씀해 주시면 바로 시간표 알려드릴게요!';
  }
  return '[MOCK] 네, 말씀 잘 들었어요. 조금 더 이야기해 주시겠어요?';
}
