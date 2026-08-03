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
import { findBomiLinkByCode, upsertHealthSummary } from '../lib/supabaseAdmin.mjs';

export default async function handler(req, res) {
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
    const link = await findBomiLinkByCode(bomiLinkCode);
    if (!link || link.status !== 'approved') {
      // 동의 안 된 상태에서의 동기화 시도는 에러가 아니라 조용히 무시 —
      // 클라이언트가 동의 상태를 잘못 캐싱했을 때 흔히 벌어질 수 있는 정상 경로.
      res.status(200).json({ ok: true, synced: false, reason: 'not_consented' });
      return;
    }
    await upsertHealthSummary(link.member_id, {
      date,
      checklist_completed: checklistCompleted ?? null,
      checklist_total: checklistTotal ?? null,
      steps: steps ?? null,
      step_goal: stepGoal ?? null,
    });
    res.status(200).json({ ok: true, synced: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
