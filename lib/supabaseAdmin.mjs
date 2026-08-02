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

// 안부 문자(enabled)와 건강리포트 알림(report_enabled)은 서로 독립적으로 켜고 끌
// 수 있어서, 둘 중 하나라도 켜진 행을 가져온 다음 send-checkins.js가 항목별로
// 각자의 enabled 플래그를 다시 확인합니다.
export async function listEnabledCheckinSettings() {
  return restRequest('bomi_checkin_settings?or=(enabled.eq.true,report_enabled.eq.true)');
}

// 인스타그램 카드뉴스 자동화(매일 건강 주제 선정 → 카드뉴스 → 텔레그램 승인 →
// 업로드) 파이프라인의 초안 이력. 스키마는 supabase/cardnews_schema.sql 참고.
export async function createCardnewsDraft(draft) {
  const rows = await restRequest('bomi_cardnews_drafts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: draft,
  });
  return rows[0];
}

export async function getCardnewsDraft(id) {
  const rows = await restRequest(`bomi_cardnews_drafts?id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

// 로컬 미리보기 스크립트(scripts/render-to-output.mjs)가 draftId 없이 "방금 만든 것"을
// 바로 확인할 수 있게 하는 용도.
export async function getLatestCardnewsDraft() {
  const rows = await restRequest('bomi_cardnews_drafts?order=created_at.desc&limit=1');
  return rows && rows[0] ? rows[0] : null;
}

export async function updateCardnewsDraft(id, patch) {
  const rows = await restRequest(`bomi_cardnews_drafts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: patch,
  });
  return rows[0];
}

// 최근 N일 이내 이미 초안으로 만들었던 원문 링크 목록 — 같은 기사를 반복해서
// 카드뉴스로 다시 뽑지 않도록 healthNewsFeed.mjs의 후보 필터링에 씀.
export async function listRecentCardnewsSourceUrls(days = 14) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await restRequest(
    `bomi_cardnews_drafts?select=source_url&created_at=gte.${encodeURIComponent(cutoff)}`
  );
  return (rows || []).map(r => r.source_url).filter(Boolean);
}
