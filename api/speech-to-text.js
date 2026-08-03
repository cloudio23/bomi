// 클라이언트(브라우저 마이크로 녹음한 16kHz 16bit mono WAV)가 base64로 오디오를
// 보내면, 네이버 클로바 스피치로 텍스트를 뽑아서 돌려줍니다. base64라 원본보다
// 요청 크기가 좀 커지지만(약 1.33배), 어차피 몇 초짜리 음성이라 문제되는
// 수준은 아니고, Vercel 서버리스 함수에서 raw binary body를 직접 받는 것보다
// 훨씬 간단하고 안정적입니다.
import { transcribeKoreanAudio } from '../lib/speechToText.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  try {
    const { audioBase64 } = req.body || {};
    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64가 필요해요.' });
      return;
    }
    const wavBuffer = Buffer.from(audioBase64, 'base64');
    const text = await transcribeKoreanAudio(wavBuffer);
    if (text === null) {
      res.status(200).json({ ok: false, message: '음성을 이해하지 못했어요. 다시 한번 말씀해 주시겠어요?' });
      return;
    }
    res.status(200).json({ ok: true, text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
