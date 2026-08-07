// 알림/구독 관련 엔드포인트를 하나로 합쳤습니다(Vercel Hobby 플랜의
// 서버리스 함수 12개 한도 때문 — 2026-08-02 QA 감사에서 여유가 0개인 걸
// 발견, 이후로도 새 액션은 계속 기존 파일에 추가하는 원칙 유지). ?action=
// 쿼리 파라미터로 구분합니다:
//
// - POST ?action=subscribe       {bomiLinkCode, subscription} → 웹 푸시 구독 등록 (보미 앱이 호출)
// - GET  ?action=greeting         → 매일 안부인사 푸시 (스케줄러가 하루 1회 호출)
// - GET  ?action=checkins         → 체크인/건강리포트/달력알람/가족리포트 발송 (스케줄러가 매시 정각 호출)
// - GET  ?action=family-status&code=...           → 응답 대기 중(pending)/활성(active) 가족 리포트 동의 상태 조회 (보미 앱이 호출)
// - POST ?action=family-consent   {bomiLinkCode, id, decision} → 동의/거절 응답
// - POST ?action=family-revoke    {bomiLinkCode}    → 이미 동의한 가족 리포트 구독 철회
// - POST ?action=family-request   {crmId, guardianName, guardianPhone} → 자녀가 구독 신청 (family.html이 호출)
// - GET  ?action=family-report&token=...           → 토큰으로 상세 리포트 데이터 조회 (report.html이 호출)
import {
  upsertPushSubscription, ensureDefaultCheckinSettings,
  listAllPushSubscriptions, listEnabledCheckinSettings, getPushSubscription,
  listPendingCalendarAlarms, markCalendarAlarmSent,
  createFamilyReportRequest, getPendingFamilyConsent, respondFamilyConsent,
  revokeFamilyConsentByCrmId, listAgreedFamilyReports, getFamilyReportByToken,
  listFamilyHealthDaily,
} from '../lib/supabaseAdmin.mjs';
import { sendPush } from '../lib/push.mjs';
import { sendAlimtalk } from '../lib/kakao.mjs';

async function handleSubscribe(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  const { bomiLinkCode, subscription } = req.body || {};
  if (!bomiLinkCode || !subscription) {
    res.status(400).json({ error: 'bomiLinkCode와 subscription이 필요해요.' });
    return;
  }
  await upsertPushSubscription(bomiLinkCode, subscription);
  // 알림을 처음 켤 때 기본 시간표(10/17/19/20/21시)로 건강 안부 문자·리포트
  // 설정을 미리 만들어둠 — 회원이 따로 설정에 들어가지 않아도 바로 동작하게.
  await ensureDefaultCheckinSettings(bomiLinkCode);
  res.status(200).json({ ok: true });
}

const GREETINGS = [
  '오늘 컨디션은 어떠세요? 궁금한 게 있으면 편하게 말 걸어주세요.',
  '좋은 아침이에요! 오늘 하루도 잘 보내고 계신가요?',
  '어젯밤엔 푹 주무셨나요? 오늘 있었던 일도 들려주세요.',
];
function pickGreeting() {
  const dayIndex = new Date().getDate() % GREETINGS.length;
  return GREETINGS[dayIndex];
}

// 앱을 안 열어도 카톡처럼 먼저 말을 거는 느낌을 주기 위한 푸시 — CRM 연동
// 여부와 무관하게 등록된 모든 보미 사용자에게 보냅니다. 지금은 일부러
// 일반적인 문구만 보냅니다(로컬 전용 프로필 원칙 유지).
async function handleGreeting(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  const subs = await listAllPushSubscriptions();
  const body = pickGreeting();
  let sent = 0;
  let failed = 0;
  for (const row of subs || []) {
    try {
      await sendPush(row.subscription, { type: 'daily_greeting', title: '보미가 안부를 물어요', body });
      sent += 1;
    } catch (e) {
      // 만료/취소된 구독은 발송 실패가 정상적인 상황 — 전체 배치를 막지 않고 건너뜀.
      failed += 1;
    }
  }
  res.status(200).json({ ok: true, total: (subs || []).length, sent, failed });
}

// 각 항목은 자기만의 enabled 플래그(enabledField)를 가져서, 안부 문자 전체를
// 꺼도 건강리포트 알림만 따로 켜둘 수 있습니다(반대도 가능). 건강리포트는
// type이 달라서(health_report_ready) sw.js가 알림을 탭했을 때 채팅이 아니라
// 리포트 화면(광고/구독 게이트)으로 바로 이동시킵니다.
const NOTIF_FIELDS = [
  { timeField: 'sleep_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '간밤에 잘 주무셨어요? 오늘 컨디션이 궁금해요.' },
  { timeField: 'meal_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '오늘 식사는 잘 챙기셨나요? 어떠셨는지 들려주세요.' },
  { timeField: 'activity_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '오늘은 어떤 운동이나 활동을 하셨을까요?' },
  { timeField: 'mood_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '평안한 하루 보내고 계신가요? 지금 기분이나 컨디션은 어떠세요?' },
  { timeField: 'report_time', enabledField: 'report_enabled', type: 'health_report_ready', title: '오늘의 건강리포트가 나왔어요', body: '광고를 보거나 구독하면 바로 확인하실 수 있어요.' },
];

function currentKstHour() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST
  return kst.getUTCHours();
}

function currentKstDateStr() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 0 = 일요일. 주간 가족 리포트는 매주 일요일 20시(KST)에만 발송합니다.
function currentKstDayOfWeek() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.getUTCDay();
}

// 달력 일정 알람 — event_date가 오늘이고 alarm_enabled인데 아직 안 보낸 것 중,
// start_time의 "시"가 지금과 같은 것만 보냅니다(체크인 알림과 같은 시 단위 매칭).
async function sendDueCalendarAlarms(hour) {
  const today = currentKstDateStr();
  const pending = await listPendingCalendarAlarms(today);
  let sent = 0;
  let failed = 0;
  for (const ev of pending || []) {
    const evHour = ev.start_time ? parseInt(String(ev.start_time).split(':')[0], 10) : null;
    if (evHour !== hour) continue;
    const sub = await getPushSubscription(ev.bomi_link_code);
    if (sub) {
      try {
        await sendPush(sub.subscription, {
          type: 'calendar_event',
          title: '보미 달력 알림',
          body: ev.title + (ev.start_time ? ` (${String(ev.start_time).slice(0, 5)})` : ''),
        });
        sent += 1;
      } catch (e) {
        failed += 1;
      }
    }
    await markCalendarAlarmSent(ev.id).catch(() => {});
  }
  return { sent, failed };
}

// 시간 비교를 "시(hour)" 단위로만 하는 이유: 스케줄러가 정시(0분)에만
// 호출하므로 분 단위까지 맞출 필요가 없고, 회원이 설정 화면에서 분 단위로
// 입력해도 그 시각이 속한 시간에 보내집니다(예: 10:30으로 설정해도 10시
// 정각에 발송).
async function handleCheckins(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  const hour = currentKstHour();
  const settingsList = await listEnabledCheckinSettings();
  let sent = 0;
  let failed = 0;
  let matched = 0;

  for (const s of settingsList || []) {
    for (const field of NOTIF_FIELDS) {
      if (!s[field.enabledField]) continue;
      const configuredHour = parseInt((s[field.timeField] || '').split(':')[0], 10);
      if (configuredHour !== hour) continue;
      matched += 1;
      const sub = await getPushSubscription(s.bomi_link_code);
      if (!sub) continue;
      try {
        await sendPush(sub.subscription, { type: field.type, title: field.title, body: field.body });
        sent += 1;
      } catch (e) {
        // 만료/취소된 구독은 정상적인 상황 — 전체 배치를 막지 않고 건너뜀.
        failed += 1;
      }
    }
  }
  const calendarResult = await sendDueCalendarAlarms(hour);
  const familyResult = await sendDueFamilyReports(currentKstDayOfWeek(), hour);
  res.status(200).json({
    ok: true, hour, matched, sent, failed,
    calendarSent: calendarResult.sent, calendarFailed: calendarResult.failed,
    familyReportSent: familyResult.sent, familyReportFailed: familyResult.failed,
  });
}

/* ============ 가족 리포트 (카카오 알림톡) ============ */

// 회원 이름은 서버에 따로 저장해두지 않는 원칙이라(로컬 전용 프로필),
// 동의 시점에 한 번 받아둔 member_name만 씁니다 — 없으면 "어르신"으로 대체.
// 체크리스트/걸음수 외의 수면·식사·활동 "수치"는 실제로 측정하는 값이
// 없어서(2026-08-02 QA 감사로 AI가 지어낸 점수를 CRM에 보내지 않기로 한
// 원칙과 동일하게) 문구에 넣지 않습니다 — 실측치만 보여줍니다.
function buildWeeklyFamilyVariables(row, dailyRows) {
  const withChecklist = dailyRows.filter((r) => r.checklist_total);
  const totalCompleted = withChecklist.reduce((sum, r) => sum + (r.checklist_completed || 0), 0);
  const totalTarget = withChecklist.reduce((sum, r) => sum + (r.checklist_total || 0), 0);
  const rate = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : null;

  const withSteps = dailyRows.filter((r) => typeof r.steps === 'number');
  const avgSteps = withSteps.length > 0
    ? Math.round(withSteps.reduce((sum, r) => sum + r.steps, 0) / withSteps.length)
    : null;

  return {
    '#{회원이름}': row.member_name || '어르신',
    '#{자녀이름}': row.guardian_name || '자녀',
    '#{체크리스트완료율}': rate === null ? '기록 없음' : `${rate}%`,
    '#{평균걸음수}': avgSteps === null ? '기록 없음' : `${avgSteps.toLocaleString('ko-KR')}보`,
    '#{링크}': `https://bomi-7sbu.vercel.app/report.html?token=${row.report_token}`,
  };
}

async function sendDueFamilyReports(dayOfWeek, hour) {
  // 매주 일요일(0) 20시(KST)에만 — 그 외 시간에는 매시 호출돼도 그냥 넘어감.
  if (dayOfWeek !== 0 || hour !== 20) return { sent: 0, failed: 0 };
  const templateId = process.env.KAKAO_WEEKLY_TEMPLATE_ID;
  const rows = await listAgreedFamilyReports();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let sent = 0;
  let failed = 0;
  for (const row of rows || []) {
    const dailyRows = await listFamilyHealthDaily(row.crm_id, since);
    const variables = buildWeeklyFamilyVariables(row, dailyRows || []);
    const result = await sendAlimtalk(row.guardian_phone, templateId, variables);
    if (result.ok) sent += 1; else failed += 1;
  }
  return { sent, failed };
}

async function handleFamilyStatus(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' }); return; }
  const code = (req.query && req.query.code) || '';
  if (!code) { res.status(400).json({ ok: false, message: 'code가 필요해요.' }); return; }
  try {
    const pending = await getPendingFamilyConsent(code);
    const active = await getActiveFamilyConsent(code);
    res.status(200).json({
      ok: true,
      pending: pending ? { id: pending.id, guardianName: pending.guardian_name } : null,
      active: active ? { guardianName: active.guardian_name, guardianPhone: active.guardian_phone } : null,
    });
  } catch (e) {
    res.status(200).json({ ok: false, message: '상태를 확인하지 못했어요.' });
  }
}

async function handleFamilyConsent(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' }); return; }
  const { bomiLinkCode, id, decision, memberName } = req.body || {};
  if (!bomiLinkCode || !id || !decision) {
    res.status(400).json({ ok: false, message: 'bomiLinkCode, id, decision이 필요해요.' });
    return;
  }
  try {
    await respondFamilyConsent(id, bomiLinkCode, decision, memberName);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, message: '처리하지 못했어요.' });
  }
}

async function handleFamilyRevoke(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' }); return; }
  const { bomiLinkCode } = req.body || {};
  if (!bomiLinkCode) { res.status(400).json({ ok: false, message: 'bomiLinkCode가 필요해요.' }); return; }
  try {
    await revokeFamilyConsentByCrmId(bomiLinkCode);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, message: '철회하지 못했어요.' });
  }
}

async function handleFamilyRequest(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' }); return; }
  const { crmId, guardianName, guardianPhone } = req.body || {};
  if (!crmId || !guardianPhone) {
    res.status(400).json({ ok: false, message: 'crmId, guardianPhone이 필요해요.' });
    return;
  }
  try {
    const row = await createFamilyReportRequest(crmId, guardianName, guardianPhone);
    res.status(200).json({ ok: true, id: row && row.id });
  } catch (e) {
    res.status(200).json({ ok: false, message: '신청을 저장하지 못했어요. 연동 코드를 다시 확인해 주세요.' });
  }
}

async function handleFamilyReport(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' }); return; }
  const token = (req.query && req.query.token) || '';
  if (!token) { res.status(400).json({ ok: false, message: 'token이 필요해요.' }); return; }
  try {
    const row = await getFamilyReportByToken(token);
    if (!row) { res.status(200).json({ ok: false, message: '유효하지 않은 링크예요.' }); return; }
    const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const daily = await listFamilyHealthDaily(row.crm_id, since);
    res.status(200).json({
      ok: true,
      memberName: row.member_name || '어르신',
      consentedAt: row.consented_at,
      daily: daily || [],
    });
  } catch (e) {
    res.status(200).json({ ok: false, message: '리포트를 불러오지 못했어요.' });
  }
}

export default async function handler(req, res) {
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'subscribe') return await handleSubscribe(req, res);
    if (action === 'greeting') return await handleGreeting(req, res);
    if (action === 'checkins') return await handleCheckins(req, res);
    if (action === 'family-status') return await handleFamilyStatus(req, res);
    if (action === 'family-consent') return await handleFamilyConsent(req, res);
    if (action === 'family-revoke') return await handleFamilyRevoke(req, res);
    if (action === 'family-request') return await handleFamilyRequest(req, res);
    if (action === 'family-report') return await handleFamilyReport(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
