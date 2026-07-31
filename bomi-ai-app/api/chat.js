// 이 파일은 브라우저가 아니라 Vercel 서버에서 실행됩니다.
// 그래서 여기 있는 API 키는 사용자에게 절대 노출되지 않아요.
//
// 실제 AI 호출 로직은 ../lib/aiProviders.mjs에 있습니다. 기본은 Gemini
// 무료 티어이고, AI_PROVIDER=anthropic 환경변수로 Claude로 수동 전환할 수
// 있어요 (자동 폴백 아님 — 예상치 못한 과금을 막기 위한 의도적 설계).
import { callAI } from '../lib/aiProviders.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }

  try {
    const { system, messages } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages 배열이 필요해요.' });
      return;
    }

    const reply = await callAI(system, messages, { maxTokens: 500 });
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
