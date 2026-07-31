// 방금 오간 대화 한 턴에서 건강 관련 신호를 뽑아내는 함수입니다.
// 언급이 없으면 해당 항목은 null로 돌아옵니다 (지어내지 않음).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되어 있지 않아요.' });
    return;
  }

  try {
    const { userText, assistantText } = req.body || {};
    if (!userText) {
      res.status(400).json({ error: 'userText가 필요해요.' });
      return;
    }

    const schema = {
      type: 'object',
      properties: {
        sleep: {
          type: 'object',
          nullable: true,
          properties: {
            hours: { type: 'number', nullable: true },
            quality: { type: 'string', enum: ['good', 'poor'], nullable: true }
          }
        },
        pain: {
          type: 'object',
          nullable: true,
          properties: {
            present: { type: 'boolean' },
            location: { type: 'string', nullable: true },
            severity: { type: 'string', enum: ['mild', 'moderate', 'severe'], nullable: true }
          }
        },
        mood: { type: 'string', enum: ['positive', 'neutral', 'negative'], nullable: true },
        meal: {
          type: 'object',
          nullable: true,
          properties: {
            count: { type: 'number', nullable: true },
            skipped: { type: 'boolean', nullable: true }
          }
        },
        activity: {
          type: 'object',
          nullable: true,
          properties: {
            did_exercise: { type: 'boolean', nullable: true },
            type: { type: 'string', nullable: true }
          }
        }
      }
    };

    const prompt = `아래는 시니어 사용자와 AI 비서 '보미'의 대화 한 턴이야.
이 대화에서 사용자가 실제로 "언급한" 건강 관련 정보만 추출해줘.
언급되지 않은 항목은 반드시 null로 남겨줘 (추측하거나 지어내지 마).

사용자: ${userText}
보미: ${assistantText || ''}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            maxOutputTokens: 300,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data?.error?.message || '추출 실패' });
      return;
    }

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '{}';
    let signals;
    try { signals = JSON.parse(text); } catch (e) { signals = {}; }
    res.status(200).json({ signals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
