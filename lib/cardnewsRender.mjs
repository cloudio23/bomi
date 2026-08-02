// 카드뉴스 슬라이드(1080x1350 PNG) 렌더러 — Puppeteer 없이 satori(JSX→SVG)
// + @resvg/resvg-js(SVG→PNG) 조합으로 만듭니다. Vercel Node 서버리스 함수 안에서
// 헤드리스 브라우저 없이 동작해서 콜드스타트/번들 크기 부담이 훨씬 적습니다.
//
// satori는 시스템 폰트를 못 읽고 폰트 바이너리를 직접 넘겨줘야 해서, Pretendard
// (보미 앱이 index.html에서 선언만 해두고 실제로 로드는 안 하고 있던 그 폰트,
// PROJECT_STATUS.md 크리에이티브 리뷰 ②번)를 lib/fonts/에 받아두고 여기서 재사용
// 합니다 — 카드뉴스와 앱 브랜드의 타이포 아이덴티티를 맞추는 효과도 있음.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1350;

// 보미 앱과 동일한 웜 베이지 팔레트(PROJECT_STATUS.md의 --blue/--navy/--accent-soft
// 값과 맞춤 — index.html의 카나나 리디자인 이후 색 토큰을 그대로 가져옴).
const COLORS = {
  bg: '#FBF8F3',
  bgSoft: '#F6F3EE',
  accentSoft: '#EDEAE4',
  ink: '#3A3128',
  sub: '#7A6F60',
  accent: '#9C7A54',
  navy: '#6F5636',
  line: '#E4DDD1',
};

let fontsCache = null;
function loadFonts() {
  if (fontsCache) return fontsCache;
  const dir = path.join(__dirname, 'fonts');
  fontsCache = [
    { name: 'Pretendard', data: readFileSync(path.join(dir, 'Pretendard-Regular.otf')), weight: 400, style: 'normal' },
    { name: 'Pretendard', data: readFileSync(path.join(dir, 'Pretendard-Bold.otf')), weight: 700, style: 'normal' },
    { name: 'Pretendard', data: readFileSync(path.join(dir, 'Pretendard-ExtraBold.otf')), weight: 800, style: 'normal' },
  ];
  return fontsCache;
}

// satori는 React 엘리먼트 형태({type, props})만 보면 되고 실제 react 패키지는
// 필요 없습니다 — 의존성을 하나 더 늘리지 않으려고 JSX 대신 이 헬퍼로 직접 구성.
function el(type, props, ...children) {
  return { type, props: { ...props, children: children.flat() } };
}

function wordmark(onImage) {
  return el('div', {
    style: { display: 'flex', alignItems: 'center', gap: 8, position: 'absolute', left: 64, bottom: 56 },
  },
    el('div', {
      style: {
        width: 28, height: 28, borderRadius: 14, background: onImage ? '#fff' : COLORS.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: onImage ? COLORS.accent : '#fff', fontSize: 16, fontWeight: 800,
      },
    }, '보'),
    el('div', { style: { display: 'flex', fontSize: 22, fontWeight: 700, color: onImage ? '#fff' : COLORS.sub } }, '보미 건강노트')
  );
}

function pageNumber(index, total, onImage) {
  return el('div', {
    style: {
      position: 'absolute', right: 64, bottom: 56, fontSize: 22, fontWeight: 700,
      color: onImage ? '#fff' : COLORS.sub, display: 'flex',
    },
  }, `${index + 1} / ${total}`);
}

// coverImageB64가 있으면(OpenAI 이미지 생성 결과, 창업자 요청: "사진은 챗지피티
// 그림생성으로 자동화") 표지 슬라이드를 풀블리드 사진 배경 + 하단 그라디언트
// 스크림 + 흰 텍스트로 렌더링합니다. 없으면(생성 실패 등 폴백) 기존 웜베이지
// 타이포그래피 전용 표지로 대체합니다 — 표지 실패가 전체 파이프라인을 막지 않도록.
function titleSlide({ kicker, heading, dateLabel, coverImageB64 }, index, total) {
  const hasImage = !!coverImageB64;
  const content = [
    el('div', {
      style: {
        display: 'flex', alignItems: 'center', padding: '14px 28px', borderRadius: 999,
        background: hasImage ? 'rgba(255,255,255,0.18)' : COLORS.accentSoft,
        color: hasImage ? '#fff' : COLORS.navy, fontSize: 26, fontWeight: 700,
        marginBottom: 40,
      },
    }, kicker || '오늘의 건강 이야기'),
    el('div', {
      style: {
        fontSize: 68, fontWeight: 800, color: hasImage ? '#fff' : COLORS.ink,
        lineHeight: 1.35, display: 'flex', whiteSpace: 'pre-wrap',
      },
    }, heading),
    el('div', {
      style: { marginTop: 48, fontSize: 26, color: hasImage ? 'rgba(255,255,255,0.85)' : COLORS.sub, display: 'flex' },
    }, dateLabel || ''),
  ];

  if (!hasImage) {
    return el('div', {
      style: {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: '120px 64px', background: COLORS.bg,
        fontFamily: 'Pretendard',
      },
    }, ...content, wordmark(false), pageNumber(index, total, false));
  }

  return el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', position: 'relative',
      fontFamily: 'Pretendard',
    },
  },
    el('img', {
      src: `data:image/png;base64,${coverImageB64}`,
      style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' },
    }),
    el('div', {
      style: {
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        background: 'linear-gradient(to top, rgba(20,14,8,0.88), rgba(20,14,8,0.25) 55%, rgba(20,14,8,0.45))',
        display: 'flex',
      },
    }),
    el('div', {
      style: {
        position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', padding: '120px 64px 180px',
      },
    }, ...content),
    wordmark(true),
    pageNumber(index, total, true),
  );
}

function contentSlide({ heading, body }, index, total) {
  return el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '120px 64px', background: COLORS.bg,
      fontFamily: 'Pretendard',
    },
  },
    el('div', {
      style: {
        width: 72, height: 72, borderRadius: 36, background: COLORS.accent, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800,
        marginBottom: 44,
      },
    }, String(index)),
    el('div', {
      style: { fontSize: 52, fontWeight: 800, color: COLORS.ink, lineHeight: 1.35, display: 'flex', whiteSpace: 'pre-wrap' },
    }, heading),
    el('div', {
      style: { marginTop: 32, fontSize: 34, fontWeight: 400, color: COLORS.sub, lineHeight: 1.6, display: 'flex', whiteSpace: 'pre-wrap' },
    }, body),
    wordmark(),
    pageNumber(index, total),
  );
}

function reflectionSlide({ heading, body, disclaimer }, index, total) {
  return el('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: '120px 64px', background: COLORS.accentSoft,
      fontFamily: 'Pretendard',
    },
  },
    el('div', {
      style: { fontSize: 30, fontWeight: 700, color: COLORS.navy, marginBottom: 36, display: 'flex' },
    }, heading || '오늘의 건강 고찰'),
    el('div', {
      style: { fontSize: 42, fontWeight: 700, color: COLORS.ink, lineHeight: 1.6, display: 'flex', whiteSpace: 'pre-wrap' },
    }, body),
    el('div', {
      style: { marginTop: 56, fontSize: 22, color: COLORS.sub, lineHeight: 1.5, display: 'flex', whiteSpace: 'pre-wrap' },
    }, disclaimer || '이 콘텐츠는 정보 제공 목적이며, 진단·치료를 대체하지 않습니다. 증상이 있다면 의료진과 상담하세요.'),
    wordmark(),
    pageNumber(index, total),
  );
}

// slide: { kind: 'title'|'content'|'reflection', ...kind별 텍스트 필드 }
// index/total은 우하단 페이지 표시(1/6 등)에 씀.
export async function renderSlidePng(slide, index, total) {
  let node;
  if (slide.kind === 'title') node = titleSlide(slide, index, total);
  else if (slide.kind === 'reflection') node = reflectionSlide(slide, index, total);
  else node = contentSlide(slide, index, total);

  const svg = await satori(node, {
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    fonts: loadFonts(),
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: SLIDE_WIDTH } });
  return resvg.render().asPng();
}
