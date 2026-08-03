// CRM 연동/동의 흐름 관련 엔드포인트 3개를 하나로 합쳤습니다(Vercel Hobby
// 플랜의 서버리스 함수 12개 한도 때문 — 2026-08-02 QA 감사에서 여유가 0개인
// 걸 발견). ?action= 쿼리 파라미터로 구분하며, 각 액션의 동작은 예전 파일
// (check-link-status.js / consent-respond.js / notify-link-request.js)과
// 완전히 동일합니다:
//
// - GET  ?action=status&code=...           → 연동 상태 조회 (보미 앱이 호출)
// - POST ?action=consent  {bomiLinkCode, decision}  → 동의/거절/철회 (보미 앱이 호출)
// - POST ?action=notify   {bomiLinkCode}    → 연동 요청 알림 발송 (웹 CRM이 호출, CORS 필요)
import { findBomiLinkByCode, updateBomiLinkStatus, getPushSubscription } from '../lib/supabaseAdmin.mjs';
import { sendPush } from '../lib/push.mjs';

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CRM_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleStatus(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  const code = (req.query && req.query.code) || '';
  if (!code) {
    res.status(400).json({ error: 'code 쿼리 파라미터가 필요해요.' });
    return;
  }
  const link = await findBomiLinkByCode(code);
  res.status(200).json({ status: link ? link.status : null });
}

async function handleConsent(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
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
}

async function handleNotify(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
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
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'status') return await handleStatus(req, res);
    if (action === 'consent') return await handleConsent(req, res);
    if (action === 'notify') return await handleNotify(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요 (status | consent | notify).' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
