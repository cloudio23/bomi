// Instagram Graph API 카루셀(여러 장) 게시 헬퍼.
//
// "Instagram API with Instagram Login" 방식 기준(2026-08-02, 실제 설정 중 발급받은
// 토큰이 IGAA로 시작하는 걸 확인하고 이 방식으로 확정) — Facebook 페이지를 경유하는
// 예전 방식(graph.facebook.com)보다 간단합니다: 호출 주소가 graph.instagram.com이고,
// IG 계정 ID를 access_token만으로 바로 조회할 수 있어서 별도 IG_BUSINESS_ACCOUNT_ID
// 설정 없이도 동작합니다(설정해두면 매 호출마다 조회를 건너뛰고 그 값을 우선 씁니다).
//
// 순서(Meta 공식 문서 기준): (1) 이미지마다 is_carousel_item=true로 개별 컨테이너
// 생성 → (2) media_type=CAROUSEL + children으로 부모 컨테이너 생성 → (3)
// media_publish로 발행. 컨테이너는 image_url을 Meta 서버가 직접 fetch하므로 그
// URL은 인증 없이 공개적으로 접근 가능해야 합니다(api/cardnews.js?action=render가 그 역할).
const GRAPH_HOST = process.env.IG_GRAPH_HOST || 'https://graph.instagram.com';
const GRAPH_VERSION = process.env.IG_GRAPH_VERSION || ''; // graph.instagram.com은 버전 없이도 동작 확인됨
const GRAPH_BASE = GRAPH_VERSION ? `${GRAPH_HOST}/${GRAPH_VERSION}` : GRAPH_HOST;

function accessToken() {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    throw new Error('IG_ACCESS_TOKEN 환경변수가 설정되어 있지 않아요. INSTAGRAM_SETUP.md를 먼저 진행해 주세요.');
  }
  return token;
}

async function graphPost(pathSegment, params) {
  const url = `${GRAPH_BASE}/${pathSegment}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data?.error?.message || `Instagram Graph API 호출 실패 (status ${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function graphGet(pathSegment, params) {
  const url = `${GRAPH_BASE}/${pathSegment}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data?.error?.message || `Instagram Graph API 호출 실패 (status ${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// IG_BUSINESS_ACCOUNT_ID를 안 정해뒀으면 토큰 소유자 본인의 IG 계정 ID를 바로
// 조회합니다 — Instagram Login 토큰은 Facebook 페이지를 안 거치므로 이 방법이
// 가장 간단하고 확실합니다.
async function resolveIgUserId(token) {
  if (process.env.IG_BUSINESS_ACCOUNT_ID) return process.env.IG_BUSINESS_ACCOUNT_ID;
  const me = await graphGet('me', { fields: 'id,username', access_token: token });
  return me.id;
}

async function waitUntilFinished(containerId, token, { retries = 6, delayMs = 2000 } = {}) {
  for (let i = 0; i < retries; i++) {
    const data = await graphGet(containerId, { fields: 'status_code', access_token: token });
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
      throw new Error(`이미지 컨테이너 처리 실패 (status_code: ${data.status_code})`);
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  // 폴링 한도를 넘겨도 대부분 이미 발행 가능한 상태라, 에러 대신 그냥 진행합니다
  // (media_publish 호출 자체가 최종 검증 역할을 함).
}

// imageUrls: api/cardnews.js?action=render가 서빙하는 슬라이드 PNG의 공개 URL 배열(2~10장).
export async function publishCarousel({ imageUrls, caption }) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error('카루셀은 이미지가 2~10장이어야 해요.');
  }
  const token = accessToken();
  const igUserId = await resolveIgUserId(token);

  const childIds = [];
  for (const imageUrl of imageUrls) {
    const child = await graphPost(igUserId + '/media', {
      image_url: imageUrl,
      is_carousel_item: 'true',
      access_token: token,
    });
    await waitUntilFinished(child.id, token);
    childIds.push(child.id);
  }

  const parent = await graphPost(igUserId + '/media', {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption || '',
    access_token: token,
  });
  await waitUntilFinished(parent.id, token);

  const published = await graphPost(igUserId + '/media_publish', {
    creation_id: parent.id,
    access_token: token,
  });
  return published.id;
}
