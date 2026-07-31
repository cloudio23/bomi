// 웹 CRM이 트레이너의 "연동 요청" 직후 직접 호출하는 엔드포인트입니다.
// (Supabase DB 트리거/웹훅을 쓰지 않고, CRM이 bomi_links insert 성공 뒤 바로
// 이 API를 fetch로 호출하는 단순한 흐름 — 그래야 발송 로직이 보미 쪽에만
// 있으면 되고, VAPID 개인키도 보미 쪽 환경변수에만 존재하면 됩니다.)
//
// CRM은 다른 오리진(도메인)에서 호출하므로 CORS를 열어줘야 합니다. CRM_ORIGIN
// 환경변수로 허용 오리진을 좁힐 수 있고, 설정 안 하면 개발 편의상 전체 허용(*)합니다.
import { getPushSubscription } from '../lib/supabaseAdmin.mjs';
import { sendPush } from '../lib/push.mjs';

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CRM_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  try {
    const { bomiLinkCode } = req.body || {};
    if (!bomiLinkCode) {
      res.status(400).json({ error: 'bomiLinkCode가 필요해요.' });
      return;
    }
    const sub = await getPushSubscription(bomiLinkCode);
    if (!sub) {
      // 회원이 아직 알림을 한 번도 허용한 적이 없는 경우 — 연동 요청 자체는
      // bomi_links에 이미 pending으로 남아있으니, 다음에 앱을 열었을 때
      // 알림 권한을 요청하는 흐름에서 자연히 확인하게 됩니다.
      res.status(200).json({ ok: true, delivered: false, reason: 'no_subscription' });
      return;
    }
    await sendPush(sub.subscription, {
      type: 'link_request',
      title: '연동 요청이 도착했어요',
      body: '담당 트레이너님이 건강 리포트 요약 공유를 요청했어요. 눌러서 확인해주세요.',
    });
    res.status(200).json({ ok: true, delivered: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
