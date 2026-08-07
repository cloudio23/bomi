// 보미 앱을 열 때(하루 1회) 호출 — 동의된 회원의 "실제로 있는" 데이터만
// CRM 쪽 bomi_health_summaries에 씁니다: 체크리스트 완료 개수(사용자가 직접
// 체크한 것)와 걸음수(네이티브 앱의 Health Connect 실측값). 원본 대화 내용은
// 절대 여기 거치지 않고, AI가 지어낸 수면/기분/영양/활동 "점수"도 더 이상
// 만들지 않습니다 — 트레이너가 실제 건강 데이터로 오해할 수 있는 지어낸
// 수치를 CRM에 넘기지 않기 위한 조치입니다(2026-08-02 QA 감사에서 발견한
// 문제 수정, 0007_real_health_signals.sql 마이그레이션 필요).
//
// 클라이언트가 "동의했다"고 우겨도 여기서 다시 한 번 bomi_links.status를
// 서버에서 직접 확인합니다 — 클라이언트 상태만 믿지 않는 게 RLS와 함께
// 이중 방어선이 되도록 하는 지점입니다.
//
// 가족 리포트(카카오 알림톡) 동의는 이 트레이너 CRM 동의와 완전히 별개라서,
// 같은 호출에서 독립적으로 한 번 더 확인해 동의된 경우에만 별도 저장소
// (bomi_family_health_daily, crm_id 기준)에 같이 기록합니다 — 두 동의 중
// 하나만 돼 있어도 그쪽 데이터만 정상적으로 쌓입니다.
// GET ?code=...&days=N → 건강리포트 화면(reportScreen)이 최근 N일(기본 14일)의
// 참여 신호(수면/식사/활동/기분 언급 여부)를 읽어가는 용도. 이 파일이 이미
// "건강 요약 동기화"를 담당하고 있어서 같은 파일에 조회 액션만 얹었습니다
// (Vercel Hobby 12개 함수 한도 때문에 새 api/ 파일을 안 늘리는 원칙).
import {
  findBomiLinkByCode, upsertHealthSummary,
  getActiveFamilyConsent, upsertFamilyHealthDaily,
  listEngagementDaily,
} from '../lib/supabaseAdmin.mjs';

async function handleGetEngagement(req, res) {
  const code = (req.query && req.query.code) || '';
  const days = Math.max(1, Math.min(60, parseInt((req.query && req.query.days) || '14', 10) || 14));
  if (!code) {
    res.status(400).json({ ok: false, message: 'code가 필요해요.' });
    return;
  }
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await listEngagementDaily(code, since);
    res.status(200).json({ ok: true, engagement: rows || [], windowDays: days });
  } catch (e) {
    res.status(200).json({ ok: false, message: '참여 기록을 불러오지 못했어요.' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return await handleGetEngagement(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  try {
    const {
      bomiLinkCode, date,
      checklistCompleted, checklistTotal, steps, stepGoal,
    } = req.body || {};
    if (!bomiLinkCode || !date) {
      res.status(400).json({ error: 'bomiLinkCode와 date가 필요해요.' });
      return;
    }

    let crmSynced = false;
    const link = await findBomiLinkByCode(bomiLinkCode);
    if (link && link.status === 'approved') {
      await upsertHealthSummary(link.member_id, {
        date,
        checklist_completed: checklistCompleted ?? null,
        checklist_total: checklistTotal ?? null,
        steps: steps ?? null,
        step_goal: stepGoal ?? null,
      });
      crmSynced = true;
    }

    let familySynced = false;
    const familyConsent = await getActiveFamilyConsent(bomiLinkCode);
    if (familyConsent) {
      await upsertFamilyHealthDaily(bomiLinkCode, { date, checklistCompleted, checklistTotal, steps });
      familySynced = true;
    }

    res.status(200).json({ ok: true, synced: crmSynced || familySynced, crmSynced, familySynced });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
