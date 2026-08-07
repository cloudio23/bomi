// 서버 전용 Supabase REST(PostgREST) 헬퍼 — service_role 키로 RLS를 우회합니다.
// @supabase/supabase-js SDK 없이 순수 fetch로 구현해서 lib/aiProviders.mjs와
// 같은 무의존성 스타일을 유지합니다. 이 파일은 절대 브라우저로 보내면 안 됩니다
// (service_role 키가 노출되면 RLS가 통째로 무력화됨) — api/ 서버리스 함수에서만 import.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 웹 CRM(deforet-w-health)이 쓰는
// 것과 동일한 Supabase 프로젝트를 가리켜야 합니다 (같은 프로젝트 공유 결정).
import { randomBytes } from 'crypto';

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되어 있지 않아요.');
  }
  return { url, key };
}

async function restRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase REST 호출 실패 (${response.status}): ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function findBomiLinkByCode(code) {
  const rows = await restRequest(
    `bomi_links?bomi_link_code=eq.${encodeURIComponent(code)}&order=requested_at.desc&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

export async function updateBomiLinkStatus(id, status) {
  return restRequest(`bomi_links?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { status, responded_at: new Date().toISOString() },
  });
}

export async function upsertPushSubscription(code, subscription) {
  return restRequest('bomi_push_subscriptions?on_conflict=bomi_link_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { bomi_link_code: code, subscription, updated_at: new Date().toISOString() },
  });
}

export async function getPushSubscription(code) {
  const rows = await restRequest(
    `bomi_push_subscriptions?bomi_link_code=eq.${encodeURIComponent(code)}&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

export async function listAllPushSubscriptions() {
  return restRequest('bomi_push_subscriptions?select=bomi_link_code,subscription');
}

export async function upsertHealthSummary(memberId, summary) {
  return restRequest('bomi_health_summaries?on_conflict=member_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { member_id: memberId, ...summary },
  });
}

export async function getCheckinSettings(code) {
  const rows = await restRequest(
    `bomi_checkin_settings?bomi_link_code=eq.${encodeURIComponent(code)}&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

export async function upsertCheckinSettings(code, settings) {
  return restRequest('bomi_checkin_settings?on_conflict=bomi_link_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { bomi_link_code: code, ...settings, updated_at: new Date().toISOString() },
  });
}

// 알림을 처음 켤 때(=푸시 구독 등록 시점) 기본 시간표로 한 행을 미리 만들어둡니다.
// 이미 설정이 있으면(회원이 시간을 직접 조정해둔 경우) 절대 덮어쓰지 않도록
// merge-duplicates가 아니라 ignore-duplicates를 씁니다.
export async function ensureDefaultCheckinSettings(code) {
  return restRequest('bomi_checkin_settings?on_conflict=bomi_link_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: { bomi_link_code: code },
  });
}

// 헤더의 "대화 가능량" 원형게이지용 — Gemini 무료 티어는 남은 할당량을 실시간
// 조회하는 방법이 없어서(초과하면 그제서야 에러), 저희가 직접 오늘 요청 수를
// 세어 자체 설정한 하루 목표치(api/usage.js의 DAILY_CHAT_BUDGET)와 비교합니다.
// 동시 요청이 몰릴 때 read-then-write라 카운트가 약간 어긋날 수 있지만, 소규모
// 센터 트래픽 규모에서는 무시 가능한 수준이라 별도 DB 함수(RPC) 없이 이 방식으로 둡니다.
export async function getDailyUsage(dateKey) {
  const rows = await restRequest(`bomi_usage_daily?usage_date=eq.${dateKey}&select=request_count`);
  return rows && rows[0] ? rows[0].request_count : 0;
}

export async function incrementDailyUsage(dateKey) {
  const current = await getDailyUsage(dateKey);
  const next = current + 1;
  await restRequest('bomi_usage_daily?on_conflict=usage_date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: { usage_date: dateKey, request_count: next, updated_at: new Date().toISOString() },
  });
  return next;
}

// 안부 문자(enabled)와 건강리포트 알림(report_enabled)은 서로 독립적으로 켜고 끌
// 수 있어서, 둘 중 하나라도 켜진 행을 가져온 다음 send-checkins.js가 항목별로
// 각자의 enabled 플래그를 다시 확인합니다.
export async function listEnabledCheckinSettings() {
  return restRequest('bomi_checkin_settings?or=(enabled.eq.true,report_enabled.eq.true)');
}

// 달력 — 한 달치 일정 조회(월 화면 렌더링용). endDateExclusive는 다음 달 1일.
export async function listCalendarEvents(code, startDate, endDateExclusive) {
  return restRequest(
    `bomi_calendar_events?bomi_link_code=eq.${encodeURIComponent(code)}` +
    `&event_date=gte.${startDate}&event_date=lt.${endDateExclusive}` +
    `&order=event_date.asc,start_time.asc.nullslast`
  );
}

export async function addCalendarEvent(code, event) {
  return restRequest('bomi_calendar_events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      bomi_link_code: code,
      event_date: event.eventDate,
      title: event.title,
      start_time: event.startTime || null,
      end_time: event.endTime || null,
      alarm_enabled: !!event.alarmEnabled,
    },
  });
}

export async function deleteCalendarEvent(code, id) {
  return restRequest(`bomi_calendar_events?id=eq.${encodeURIComponent(id)}&bomi_link_code=eq.${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

// 안드로이드 네이티브 앱이 휴대폰 기본 캘린더에도 같은 일정을 만든 뒤, 그
// 기기 쪽 이벤트 id를 이 행에 같이 저장해둡니다 — 나중에 이 일정을 삭제할 때
// 기기 캘린더에서도 같은 이벤트를 지우려면 이 id가 필요합니다.
export async function setCalendarEventNativeId(code, id, nativeEventId) {
  return restRequest(`bomi_calendar_events?id=eq.${encodeURIComponent(id)}&bomi_link_code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: { native_event_id: nativeEventId },
  });
}

// 가족 리포트(카카오 알림톡) — 자녀가 crmId로 구독을 신청하면 pending row가
// 생기고, 회원(어르신) 쪽 앱이 동의해야 실제 발송이 시작됩니다. 트레이너
// CRM 연동(bomi_links)과는 완전히 별개의 동의 체계입니다 — 섞지 않습니다.
export async function createFamilyReportRequest(crmId, guardianName, guardianPhone) {
  const reportToken = randomBytes(24).toString('hex');
  const rows = await restRequest('bomi_family_reports', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      crm_id: crmId,
      guardian_name: guardianName || null,
      guardian_phone: guardianPhone,
      report_token: reportToken,
    },
  });
  return rows && rows[0];
}

export async function getPendingFamilyConsent(crmId) {
  const rows = await restRequest(
    `bomi_family_reports?crm_id=eq.${encodeURIComponent(crmId)}&consent_status=eq.pending&order=created_at.desc&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

// memberName은 회원 본인 앱이 동의하는 시점에 자기 profile.name을 실어 보낸 것 —
// 서버에는 어르신 이름을 따로 저장해두지 않으므로(로컬 전용 프로필 원칙),
// 알림톡 문구에 쓸 이름을 이 시점에만 한 번 받아 저장합니다.
export async function respondFamilyConsent(id, crmId, decision, memberName) {
  const status = decision === 'agreed' ? 'agreed' : 'revoked';
  return restRequest(`bomi_family_reports?id=eq.${encodeURIComponent(id)}&crm_id=eq.${encodeURIComponent(crmId)}`, {
    method: 'PATCH',
    body: {
      consent_status: status,
      consented_at: status === 'agreed' ? new Date().toISOString() : null,
      ...(status === 'agreed' && memberName ? { member_name: memberName } : {}),
    },
  });
}

export async function getActiveFamilyConsent(crmId) {
  const rows = await restRequest(
    `bomi_family_reports?crm_id=eq.${encodeURIComponent(crmId)}&consent_status=eq.agreed&order=created_at.desc&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

export async function revokeFamilyConsentByCrmId(crmId) {
  return restRequest(`bomi_family_reports?crm_id=eq.${encodeURIComponent(crmId)}&consent_status=eq.agreed`, {
    method: 'PATCH',
    body: { consent_status: 'revoked' },
  });
}

export async function listAgreedFamilyReports() {
  return restRequest('bomi_family_reports?consent_status=eq.agreed');
}

export async function getFamilyReportByToken(token) {
  const rows = await restRequest(
    `bomi_family_reports?report_token=eq.${encodeURIComponent(token)}&consent_status=eq.agreed&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

// 최근 며칠치 체크리스트 완료율·걸음수 실측치 — bomi_health_summaries(트레이너
// CRM 동의 전용, member_id 기준)와는 독립된 저장소입니다. 가족 리포트 동의와
// CRM 연동 동의는 서로 다른 결정이라, 한쪽만 동의해도 그쪽 데이터만 쌓입니다.
export async function upsertFamilyHealthDaily(crmId, summary) {
  return restRequest('bomi_family_health_daily?on_conflict=crm_id,summary_date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: {
      crm_id: crmId,
      summary_date: summary.date,
      checklist_completed: summary.checklistCompleted ?? null,
      checklist_total: summary.checklistTotal ?? null,
      steps: summary.steps ?? null,
      updated_at: new Date().toISOString(),
    },
  });
}

export async function listFamilyHealthDaily(crmId, sinceDate) {
  return restRequest(
    `bomi_family_health_daily?crm_id=eq.${encodeURIComponent(crmId)}&summary_date=gte.${sinceDate}&order=summary_date.asc`
  );
}

// 체크리스트 위젯에 "오늘 일정"으로 같이 보여주기 위한 조회.
export async function listCalendarEventsForDate(code, dateStr) {
  return restRequest(
    `bomi_calendar_events?bomi_link_code=eq.${encodeURIComponent(code)}&event_date=eq.${dateStr}&order=start_time.asc.nullslast`
  );
}

// 알림 스케줄러(매시 정각)가 오늘 날짜의 알람 켜진 일정 중 아직 안 보낸 것만
// 전체 사용자 기준으로 가져갑니다 — 시(hour) 비교는 notifications.js에서 처리.
export async function listPendingCalendarAlarms(dateStr) {
  return restRequest(`bomi_calendar_events?event_date=eq.${dateStr}&alarm_enabled=eq.true&alarm_sent=eq.false`);
}

export async function markCalendarAlarmSent(id) {
  return restRequest(`bomi_calendar_events?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { alarm_sent: true },
  });
}

// 비상연락처(보이스피싱 의심 알림 문자 수신자) — 온보딩 또는 프로필 설정에서 등록.
export async function listEmergencyContacts(code) {
  return restRequest(
    `bomi_emergency_contacts?bomi_link_code=eq.${encodeURIComponent(code)}&order=created_at.asc`
  );
}

export async function addEmergencyContact(code, contact) {
  return restRequest('bomi_emergency_contacts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      bomi_link_code: code,
      name: contact.name,
      phone: contact.phone,
      relation: contact.relation || null,
    },
  });
}

export async function deleteEmergencyContact(code, id) {
  return restRequest(
    `bomi_emergency_contacts?id=eq.${encodeURIComponent(id)}&bomi_link_code=eq.${encodeURIComponent(code)}`,
    { method: 'DELETE' }
  );
}
