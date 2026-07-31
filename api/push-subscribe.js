// 회원 폰의 웹 푸시 구독 정보를 저장합니다. CRM 연동 여부와 무관하게 모든 보미
// 사용자가 이걸 등록해야 "매일 아침 안부인사" 푸시를 받을 수 있습니다.
import { upsertPushSubscription } from '../lib/supabaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  try {
    const { bomiLinkCode, subscription } = req.body || {};
    if (!bomiLinkCode || !subscription) {
      res.status(400).json({ error: 'bomiLinkCode와 subscription이 필요해요.' });
      return;
    }
    await upsertPushSubscription(bomiLinkCode, subscription);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
