// 보미 앱을 열 때(하루 1회) 호출되는 기본 POST(action 없음)는 동의된 회원의
// "실제로 있는" 데이터만 CRM 쪽 bomi_health_summaries에 씁니다: 체크리스트
// 완료 개수(사용자가 직접 체크한 것)와 걸음수(네이티브 앱의 Health Connect
// 실측값). 원본 대화 내용은 절대 여기 거치지 않고, AI가 지어낸 수면/기분/
// 영양/활동 "점수"도 만들지 않습니다 — 트레이너가 실제 건강 데이터로 오해할
// 수 있는 지어낸 수치를 CRM에 넘기지 않기 위한 조치입니다.
//
// 클라이언트가 "동의했다"고 우겨도 여기서 다시 한 번 bomi_links.status를
// 서버에서 직접 확인합니다 — 클라이언트 상태만 믿지 않는 게 RLS와 함께
// 이중 방어선이 되도록 하는 지점입니다.
//
// 가족 리포트(카카오 알림톡) 동의는 이 트레이너 CRM 동의와 완전히 별개라서,
// 같은 호출에서 독립적으로 한 번 더 확인해 동의된 경우에만 별도 저장소
// (bomi_family_health_daily, crm_id 기준)에 같이 기록합니다.
//
// 이 파일이 이미 "건강 요약"을 담당하고 있어서, 건강리포트(일간/주간/월간)의
// 메인 데이터인 구조화 체크인(수면·걸음수·기분)과 리포트 조회 액션도 같은
// 파일에 얹었습니다(Vercel Hobby 12개 함수 한도 때문에 새 api/ 파일을 안
// 늘리는 원칙). 식사 사진/텍스트는 api/chat.js가 담당합니다(Gemini 비전
// 호출이 이미 거기 있어서).
//
// - POST (action 없음) {bomiLinkCode, date, checklistCompleted, checklistTotal, steps, stepGoal} → 기존 CRM/가족 동기화
// - POST ?action=daily-checkin {bomiLinkCode, date, sleepScore?, steps?, moodScore?} → 구조화 체크인 부분 저장(0~5 슬라이더/걸음수)
// - GET  ?action=daily-checkin&code=...&date=YYYY-MM-DD → 특정 날짜 체크인 조회(오늘 이미 답했는지 확인용)
// - GET  ?action=report&code=...&period=daily|weekly|monthly → 일간(1일)/주간(7일)/월간(28일) 원자료(체크인+식사기록) 조회,
//   집계(평균/데이터부족 판단)는 클라이언트가 계산
import {
  findBomiLinkByCode, upsertHealthSummary,
  getActiveFamilyConsent, upsertFamilyHealthDaily,
  upsertDailyCheckin, getDailyCheckin, listDailyCheckins, listMealLogsForDate, listMealLogs,
} from '../lib/supabaseAdmin.mjs';

function currentKstDateStr() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function handleGetDailyCheckin(req, res) {
  const code = (req.query && req.query.code) || '';
  const date = (req.query && req.query.date) || currentKstDateStr();
  if (!code) { res.status(400).json({ ok: false, message: 'code가 필요해요.' }); return; }
  try {
    const [checkin, meals] = await Promise.all([
      getDailyCheckin(code, date),
      listMealLogsForDate(code, date),
    ]);
    res.status(200).json({ ok: true, checkin: checkin || null, meals: meals || [] });
  } catch (e) {
    res.status(200).json({ ok: false, message: '체크인 기록을 불러오지 못했어요.' });
  }
}

async function handlePostDailyCheckin(req, res) {
  const { bomiLinkCode, date, sleepScore, steps, moodScore } = req.body || {};
  if (!bomiLinkCode || !date) {
    res.status(400).json({ ok: false, message: 'bomiLinkCode, date가 필요해요.' });
    return;
  }
  try {
    const saved = await upsertDailyCheckin(bomiLinkCode, date, { sleepScore, steps, moodScore });
    res.status(200).json({ ok: true, checkin: saved && saved[0] });
  } catch (e) {
    res.status(200).json({ ok: false, message: '체크인을 저장하지 못했어요.' });
  }
}

async function handleReport(req, res) {
  const code = (req.query && req.query.code) || '';
  const period = (req.query && req.query.period) || 'daily';
  const windowDays = period === 'monthly' ? 28 : period === 'weekly' ? 7 : 1;
  if (!code) { res.status(400).json({ ok: false, message: 'code가 필요해요.' }); return; }
  try {
    const since = new Date(Date.now() - (windowDays - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [checkins, meals] = await Promise.all([
      listDailyCheckins(code, since),
      listMealLogs(code, since),
    ]);
    res.status(200).json({ ok: true, period, windowDays, checkins: checkins || [], meals: meals || [] });
  } catch (e) {
    res.status(200).json({ ok: false, message: '리포트를 불러오지 못했어요.' });
  }
}

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || '';

  if (req.method === 'GET' && action === 'daily-checkin') return await handleGetDailyCheckin(req, res);
  if (req.method === 'GET' && action === 'report') return await handleReport(req, res);
  if (req.method === 'POST' && action === 'daily-checkin') return await handlePostDailyCheckin(req, res);

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
