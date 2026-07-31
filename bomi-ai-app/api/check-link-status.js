// 앱을 열 때마다 가볍게 한 번 확인하는 보조 경로입니다. 연동 요청 알림은
// 기본적으로 푸시로 오지만, 회원이 알림 권한을 아직 허용 전이거나 알림을
// 놓쳤을 때를 대비한 안전망 — 대기중인 연동 요청이 있으면 동의 화면을 띄웁니다.
import { findBomiLinkByCode } from '../lib/supabaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  try {
    const code = (req.query && req.query.code) || '';
    if (!code) {
      res.status(400).json({ error: 'code 쿼리 파라미터가 필요해요.' });
      return;
    }
    const link = await findBomiLinkByCode(code);
    res.status(200).json({ status: link ? link.status : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
