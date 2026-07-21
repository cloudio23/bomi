// 이 파일은 브라우저가 아니라 Vercel 서버에서 실행됩니다.
// 그래서 여기 있는 API 키는 사용자에게 절대 노출되지 않아요.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않아요. Vercel 프로젝트 설정에서 등록해 주세요.' });
    return;
  }

  try {
    const { system, messages } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'messages 배열이 필요해요.' });
      return;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        // 실제 배포에서는 최신 모델 이름을 https://docs.claude.com 에서 확인하고 필요시 교체하세요.
        model: 'claude-sonnet-5',
        max_tokens: 300,
        system: system || '',
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data?.error?.message || '앤트로픽 API 호출에 실패했어요.' });
      return;
    }

    const textBlock = (data.content || []).find(c => c.type === 'text');
    res.status(200).json({ reply: textBlock ? textBlock.text : '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
