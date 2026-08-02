// 카드뉴스 슬라이드를 로컬 output/ 폴더에 날짜별로 저장하는 미리보기 스크립트.
// 텔레그램/Vercel 배포 없이 디자인을 바로 확인하거나(데모 모드), 실제 생성된
// 초안을 다운로드해서 수동 업로드용 아카이브로 남기고 싶을 때 씁니다.
//
// 사용법:
//   node scripts/render-to-output.mjs            → 데모 주제로 즉시 렌더 (Supabase 불필요)
//   node scripts/render-to-output.mjs --latest    → Supabase의 가장 최근 초안을 렌더
//   node scripts/render-to-output.mjs <draftId>   → 특정 초안을 렌더
//
// 주의: Vercel 서버리스 파일시스템은 요청 사이에 초기화되므로(ephemeral), 이
// output/ 폴더는 프로덕션 자동화 경로가 아니라 "로컬 실행 전용" 아카이브입니다.
// 실제 파이프라인은 Supabase(bomi_cardnews_drafts)를 기록으로 삼습니다.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSlidePng } from '../lib/cardnewsRender.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = path.join(__dirname, '..', 'output');

const DEMO_DRAFT = {
  id: 'demo',
  created_at: new Date().toISOString(),
  topic_title: '걷기 운동, 제대로 하고 계신가요?',
  source_name: '데모(실제 뉴스 아님)',
  source_url: null,
  caption: '천천히 걷기만 해도 혈압·혈당 관리에 도움이 됩니다. 저장해두고 필요할 때 다시 보세요.\n#건강 #시니어건강 #걷기운동 #보미건강노트',
  slides: [
    { kind: 'title', kicker: '오늘의 건강 이야기', heading: '걷기 운동,\n제대로 하고 계신가요?', dateLabel: new Date().toLocaleDateString('ko-KR') },
    { kind: 'content', heading: '하루 20분이면 충분', body: '천천히 걷더라도 매일 꾸준히 걷는 것이 혈압과 혈당 관리에 큰 도움이 됩니다.' },
    { kind: 'content', heading: '식후 걷기의 효과', body: '식사 후 10~15분만 가볍게 걸어도 혈당이 급격히 오르는 것을 막는 데 도움이 됩니다.' },
    { kind: 'content', heading: '무릎이 걱정된다면', body: '평지 위주로, 편안한 신발을 신고 걷는 것부터 천천히 시작해보세요.' },
    { kind: 'reflection', heading: '오늘의 건강 고찰', body: '거창한 운동보다 매일 실천할 수 있는 작은 습관이 건강을 지킵니다. 오늘도 잠깐이라도 걸어보아요.' },
  ],
};

async function loadDraft(arg) {
  if (!arg) return DEMO_DRAFT;
  const { getCardnewsDraft, getLatestCardnewsDraft } = await import('../lib/supabaseAdmin.mjs');
  if (arg === '--latest') {
    const draft = await getLatestCardnewsDraft();
    if (!draft) throw new Error('Supabase에 저장된 카드뉴스 초안이 없어요.');
    return draft;
  }
  const draft = await getCardnewsDraft(arg);
  if (!draft) throw new Error(`draftId "${arg}"를 찾을 수 없어요.`);
  return draft;
}

async function main() {
  const arg = process.argv[2];
  const draft = await loadDraft(arg);

  const dateFolder = (draft.created_at || new Date().toISOString()).slice(0, 10);
  const dir = path.join(OUTPUT_ROOT, dateFolder, String(draft.id));
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < draft.slides.length; i++) {
    const png = await renderSlidePng(draft.slides[i], i, draft.slides.length);
    writeFileSync(path.join(dir, `slide-${i + 1}.png`), png);
  }
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id: draft.id,
    topic_title: draft.topic_title,
    source_name: draft.source_name,
    source_url: draft.source_url,
    caption: draft.caption,
  }, null, 2));

  console.log(`저장 완료: ${dir} (${draft.slides.length}장)`);
}

main().catch(e => {
  console.error('실패:', e.message);
  process.exit(1);
});
