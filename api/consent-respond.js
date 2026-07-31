// 보미 앱의 동의 화면에서 회원이 수락/거절했을 때 호출됩니다. bomi_links의
// status를 바꾸는 유일한 경로 — 트레이너(CRM)는 이 컬럼을 바꿀 RLS 권한이 없고,
// 여기는 service_role로 접근하므로 RLS를 우회해서 실제로 상태를 확정합니다.
import { findBomiLinkByCode, updateBomiLinkStatus } from '../lib/supabaseAdmin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  try {
    const { bomiLinkCode, decision } = req.body || {};
    if (!bomiLinkCode || !['approved', 'declined', 'revoked'].includes(decision)) {
      res.status(400).json({ error: 'bomiLinkCode와 올바른 decision이 필요해요.' });
      return;
    }
    const link = await findBomiLinkByCode(bomiLinkCode);
    if (!link) {
      res.status(404).json({ error: '연동 요청을 찾을 수 없어요.' });
      return;
    }
    // 이미 승인된 연동을 나중에 회원이 스스로 철회(revoked)하는 것도 이 API로
    // 처리하지만, 대기중이 아닌 요청을 다시 approve/decline으로 되돌리는 건
    // 막습니다(이미 응답된 요청을 재요청 없이 바꾸는 경로는 없어야 함).
    if (decision !== 'revoked' && link.status !== 'pending') {
      res.status(409).json({ error: '이미 응답된 연동 요청이에요.' });
      return;
    }
    if (decision === 'revoked' && link.status !== 'approved') {
      res.status(409).json({ error: '승인된 연동만 철회할 수 있어요.' });
      return;
    }
    await updateBomiLinkStatus(link.id, decision);
    res.status(200).json({ ok: true, status: decision });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
