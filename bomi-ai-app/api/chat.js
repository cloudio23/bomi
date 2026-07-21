// 이 파일은 브라우저가 아니라 Vercel 서버에서 실행됩니다.
// 그래서 여기 있는 API 키는 사용자에게 절대 노출되지 않아요.
//
// Google AI Studio(https://aistudio.google.com)에서 무료로 발급받은 키를
// Vercel 환경변수 GEMINI_API_KEY 에 등록해서 쓰는 버전입니다.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되어 있지 않아요. Vercel 프로젝트 설정에서 등록해 주세요.' });
    return;
  }

  try {
    const { system, messages } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages 배열이 필요해요.' });
      return;
    }

    // 우리 앱의 role('user'/'assistant')을 Gemini가 쓰는 role('user'/'model')로 변환
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // 무료 티어에서 쓸 수 있는 모델이에요. 요금제를 바꾸거나 최신 모델로 교체하고
    // 싶으면 이 이름만 바꾸면 됩니다. (참고: https://ai.google.dev/gemini-api/docs/models)
    const MODEL = 'gemini-2.5-flash';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system || '' }] },
          contents,
          tools: [{ google_search: {} }], // 실시간 구글 검색으로 답을 보강 (버스/지하철 경로 등 정확도 향상)
          generationConfig: {
            maxOutputTokens: 700,
            thinkingConfig: { thinkingBudget: 0 } // 생각하는 토큰을 꺼서 답변이 잘리지 않게 함
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data?.error?.message || 'Gemini API 호출에 실패했어요.' });
      return;
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.status(200).json({ reply: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
