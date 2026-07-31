import { callBomiApi } from './callBomiApi.mjs';
import { CRITERIA } from '../rubric.mjs';

const JUDGE_SIGNATURE = '당신은 시니어(어르신) 대상 AI 채팅 서비스의 QA 심사관입니다.';

function stripCodeFence(raw) {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
}

export async function judgeConversation({ personaLabel, transcript, criteriaIds }) {
  const criteria = CRITERIA.filter(c => criteriaIds.includes(c.id));
  const rubricText = criteria.map(c => `- ${c.id} (${c.label}, 슬라이드 ${c.slideRef}): ${c.judge}`).join('\n');
  const system = `${JUDGE_SIGNATURE}
대화 상대는 "${personaLabel}"입니다. 아래 대화 기록에서 "보미"(assistant)의 응답만 아래 기준별로 1~5점(5=완벽히 부합, 1=심각하게 위반)으로 채점하세요.
평가 기준:
${rubricText}
반드시 아래 JSON 형식으로만 답하세요. 다른 설명·마크다운 코드블록 없이 순수 JSON만 출력하세요.
{"scores": {"<criterion_id>": {"score": <1-5>, "reason": "<한국어 한 문장>"}}, "flagged_quotes": ["<문제가 된 보미의 문장, 없으면 빈 배열>"]}`;

  const userContent = transcript.map(t => `${t.role === 'user' ? '어르신' : '보미'}: ${t.content}`).join('\n');
  const raw = await callBomiApi(system, [{ role: 'user', content: userContent }], { maxTokens: 700 });
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch (e) {
    return { scores: {}, flagged_quotes: [], parseError: raw };
  }
}

export async function judgeGreetingVariety({ personaLabel, openers, replies }) {
  const system = `${JUDGE_SIGNATURE}
"${personaLabel}" 어르신이 서로 다른 날 아침 각각 "${openers.join('" / "')}"라고 인사했을 때, 보미가 매번 어떻게 답했는지 비교합니다.
세 응답이 문구·구조 면에서 서로 얼마나 겹치는지 1~5점으로 채점하세요 (1=거의 동일한 문구를 복사한 수준/형식적, 5=매번 표현과 화제가 신선하고 다양함).
반드시 아래 JSON 형식으로만, 마크다운 코드블록 없이 답하세요.
{"score": <1-5>, "reason": "<한국어 한 문장>"}`;
  const userContent = replies.map((r, i) => `[${i + 1}번째 아침] 어르신: "${openers[i]}" / 보미: "${r}"`).join('\n');
  const raw = await callBomiApi(system, [{ role: 'user', content: userContent }], { maxTokens: 300 });
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch (e) {
    return { score: null, reason: null, parseError: raw };
  }
}
