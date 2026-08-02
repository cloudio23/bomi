// 카드뉴스 표지 사진을 ChatGPT(OpenAI) 이미지 생성으로 자동으로 만듭니다.
// (창업자 요청: "사진은 챗지피티 그림생성으로 받아서 자동화") — OPENAI_API_KEY 필요.
//
// 카드뉴스 전체(표지+본문+고찰) 슬라이드마다 이미지를 생성하면 매일 비용/실패
// 지점이 늘어나므로, 의도적으로 표지(1번 슬라이드) 한 장만 생성합니다. 본문/고찰
// 슬라이드는 satori 타이포그래피 템플릿(가독성 우선, 어르신 타깃)을 그대로 씁니다.
// b64_json으로 직접 받아서(URL 방식 대신) satori에 data URI로 바로 꽂을 수 있게 합니다.
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

const STYLE_SUFFIX = '. Warm, soft editorial photography style, gentle natural light, warm beige and brown tones, ' +
  'calm and reassuring mood suited for an elderly-friendly health content brand. No text, no letters, no numbers, ' +
  'no watermark in the image.';

export async function generateCoverImageB64(topicPromptEn) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되어 있지 않아요.');
  }
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: topicPromptEn + STYLE_SUFFIX,
      size: '1024x1536',
      quality: 'medium',
      n: 1,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI 이미지 생성 실패 (status ${res.status})`);
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI가 이미지를 반환하지 않았어요.');
  return b64;
}
