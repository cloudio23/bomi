// 네이버 클로바 스피치(CLOVA Speech Recognition, CSR)로 한국어 음성을 텍스트로
// 바꿉니다. 구글 STT보다 한국어 인식 정확도가 높고(특히 어르신들의 불분명한
// 발음), 클라이언트가 16kHz 16bit mono WAV로 인코딩해서 보내주면 그대로
// 전달합니다 — 별도의 서버 측 오디오 변환(ffmpeg 등)이 필요 없습니다.
//
// 실제 API로 연결 확인 완료(2026-08-01): 무음 WAV로 테스트했을 때
// {"text":""}가 정상적으로 돌아왔습니다.
export async function transcribeKoreanAudio(wavBuffer) {
  const clientId = process.env.NAVER_CSR_CLIENT_ID;
  const clientSecret = process.env.NAVER_CSR_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const response = await fetch('https://naveropenapi.apigw.ntruss.com/recog/v1/stt?lang=Kor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
      body: wavBuffer,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.text === 'string' ? data.text : null;
  } catch (e) {
    return null;
  }
}
