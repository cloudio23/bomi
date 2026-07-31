// 보미 앱이 건강리포트 화면을 그릴 때(하루 1회) 호출 — 동의된 회원의 요약
// 점수만 CRM 쪽 bomi_health_summaries에 씁니다. 원본 대화 내용은 절대 여기
// 거치지 않습니다(건강리포트에서 이미 계산된 요약 점수만 전달).
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
      sleepScore, nutritionScore, activityScore, mentalScore, overallScore,
      summaryText,
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
      sleep_score: sleepScore ?? null,
      nutrition_score: nutritionScore ?? null,
      activity_score: activityScore ?? null,
      mental_score: mentalScore ?? null,
      overall_score: overallScore ?? null,
      summary_text: summaryText || null,
    });
    res.status(200).json({ ok: true, synced: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
