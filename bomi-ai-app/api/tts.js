// 마이크 모드 답변을 실제 음성으로 읽어주는 엔드포인트 — Google Cloud
// Text-to-Speech(Chirp3-HD 고급 음성, 무료 티어 매달 100만 자)를 씁니다.
// 브라우저 내장 SpeechSynthesis보다 훨씬 자연스러운 목소리가 필요해서
// 추가했고, 이 호출이 실패하면 클라이언트가 자동으로 내장 음성으로
// 대체합니다(index.html의 speakVoiceReply 참고) — 항상 뭔가는 들리게.
//
// POST { text } → { ok, audioBase64 } (MP3, base64)
//
// 환경변수:
// - GOOGLE_TTS_API_KEY: Google Cloud Console → "Cloud Text-to-Speech API" 사용
//   설정 → 기존 API 키(맛집 기능의 GOOGLE_PLACES_API_KEY와 같은 키도 가능 —
//   그 키의 "API 제한사항"에 Cloud Text-to-Speech API를 추가했다면 그대로 재사용)
// - GOOGLE_TTS_VOICE: 선택, 기본값 ko-KR-Chirp3-HD-Aoede(여성) — 다른 목소리로
//   바꾸려면 voices:list 응답에 나온 ko-KR-* 이름 중 하나로 지정
const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const VOICE_NAME = process.env.GOOGLE_TTS_VOICE || 'ko-KR-Chirp3-HD-Aoede';
const MAX_CHARS = 800; // 한 번에 너무 긴 텍스트를 보내지 않도록(응답시간 보호)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' });
    return;
  }
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) {
    res.status(200).json({ ok: false, message: '음성 안내를 사용할 수 없어요.' });
    return;
  }
  const text = ((req.body && req.body.text) || '').trim().slice(0, MAX_CHARS);
  if (!text) {
    res.status(400).json({ ok: false, message: 'text가 필요해요.' });
    return;
  }
  try {
    const response = await fetch(`${TTS_ENDPOINT}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'ko-KR', name: VOICE_NAME },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
      }),
    });
    if (!response.ok) {
      res.status(200).json({ ok: false, message: '음성 안내를 만들지 못했어요.' });
      return;
    }
    const data = await response.json();
    if (!data.audioContent) {
      res.status(200).json({ ok: false, message: '음성 안내를 만들지 못했어요.' });
      return;
    }
    res.status(200).json({ ok: true, audioBase64: data.audioContent });
  } catch (e) {
    res.status(200).json({ ok: false, message: '음성 안내를 만드는 중 문제가 생겼어요.' });
  }
}
