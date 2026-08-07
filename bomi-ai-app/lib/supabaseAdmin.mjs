// 서버 전용 Supabase REST(PostgREST) 헬퍼 — service_role 키로 RLS를 우회합니다.
// @supabase/supabase-js SDK 없이 순수 fetch로 구현해서 lib/aiProviders.mjs와
// 같은 무의존성 스타일을 유지합니다. 이 파일은 절대 브라우저로 보내면 안 됩니다
// (service_role 키가 노출되면 RLS가 통째로 무력화됨) — api/ 서버리스 함수에서만 import.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 웹 CRM(deforet-w-health)이 쓰는
// 것과 동일한 Supabase 프로젝트를 가리켜야 합니다 (같은 프로젝트 공유 결정).

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
