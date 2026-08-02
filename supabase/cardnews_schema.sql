-- 인스타그램 카드뉴스 자동화 파이프라인용 테이블.
-- 보미 앱의 다른 기능(bomi_links, bomi_checkin_settings 등)과 같은 Supabase
-- 프로젝트에 이 스크립트를 한 번 실행하면 됩니다: Supabase 대시보드 →
-- SQL Editor → 아래 전체를 붙여넣고 Run.

create extension if not exists pgcrypto;

create table if not exists bomi_cardnews_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topic_title text not null,
  source_url text,
  source_name text,
  slides jsonb not null,        -- [{kind, heading, body, ...}, ...] — lib/cardnewsRender.mjs가 그대로 렌더링
  caption text,                 -- 인스타그램 게시물 캡션(해시태그 포함)
  status text not null default 'pending', -- pending | approved | rejected | published | failed
  ig_media_id text,             -- 발행 성공 시 Instagram media id
  published_at timestamptz,
  error_message text
);

-- api/cardnews.js의 listRecentCardnewsSourceUrls(최근 N일 중복 방지)가 매일
-- 조회하는 인덱스.
create index if not exists idx_bomi_cardnews_drafts_created_at
  on bomi_cardnews_drafts (created_at desc);

-- service_role 키(lib/supabaseAdmin.mjs)로만 접근하므로 RLS는 기본적으로
-- 전체 차단해두고 서버리스 함수만 우회하게 합니다(다른 보미 테이블과 동일 패턴).
alter table bomi_cardnews_drafts enable row level security;
