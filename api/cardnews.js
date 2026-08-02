// 인스타그램 건강 카드뉴스 자동화 파이프라인 3개 액션을 한 파일로 합쳤습니다
// (notifications.js와 같은 이유 — Vercel Hobby 플랜 서버리스 함수 12개 한도,
// 2026-08-02 QA 감사에서 여유 0개였던 그 제약이 여전히 유효함).
//
// ?action=
//   - render   GET   카드뉴스 슬라이드 PNG 서빙. 공개 엔드포인트(인증 없음) —
//               Telegram/Instagram 서버가 이 URL을 직접 fetch해야 하므로 의도적으로 그렇습니다.
//   - cron     GET   Vercel Cron이 매일 1회 호출: RSS에서 건강 주제 후보 조회 →
//               LLM으로 카드뉴스 카피 생성 → OpenAI로 표지 사진 생성 → 초안 저장 →
//               텔레그램으로 미리보기+승인/거절 버튼 전송. CRON_SECRET으로 보호(필수 —
//               없으면 아무나 호출해서 매일 여러 번 OpenAI/LLM 비용을 쓰게 할 수 있음).
//   - webhook  POST  Telegram 웹훅: 승인/거절 버튼 콜백 처리. 승인 시 실제로
//               Instagram Graph API로 발행. TELEGRAM_WEBHOOK_SECRET으로 보호(필수 —
//               없으면 아무나 이 URL로 실제 게시물을 올리게 할 수 있음).
//
// 준비 절차(Instagram/Telegram 계정·앱 설정, 필요한 환경변수 목록)는 INSTAGRAM_SETUP.md 참고.
import {
  createCardnewsDraft, getCardnewsDraft, updateCardnewsDraft, listRecentCardnewsSourceUrls,
} from '../lib/supabaseAdmin.mjs';
import { callAI } from '../lib/aiProviders.mjs';
import { fetchHealthTopicCandidates } from '../lib/healthNewsFeed.mjs';
import { renderSlidePng } from '../lib/cardnewsRender.mjs';
import { generateCoverImageB64 } from '../lib/aiImageGen.mjs';
import { sendCardnewsPreview, sendApprovalPrompt, answerCallbackQuery, editMessageText } from '../lib/telegram.mjs';
import { publishCarousel } from '../lib/instagramApi.mjs';

function resolveBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || process.env.VERCEL_URL;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function slideRenderUrls(baseUrl, draftId, slideCount) {
  return Array.from({ length: slideCount }, (_, i) => `${baseUrl}/api/cardnews?action=render&id=${draftId}&slide=${i}`);
}

function kstDateLabel() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

// LLM이 ```json 코드펜스로 감싸서 답하는 경우가 흔해서(aiProviders.mjs는 순수
// 텍스트만 돌려주므로 이쪽에서 방어) 코드펜스를 벗겨내고 JSON.parse합니다.
function parseJsonLoose(text) {
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

const COPY_SYSTEM_PROMPT = `당신은 어르신 대상 건강 동반 앱 "보미"의 인스타그램 카드뉴스 작가입니다.
독자는 시니어(60대 이상)이거나 그 가족입니다. 아래 원칙을 반드시 지키세요:
- 쉬운 말, 짧은 문장, 존댓말. 의학 용어는 풀어서 설명.
- 자극적/공포 유발 표현 금지("당장 이것 안 하면 큰일" 같은 클릭베이트 금지). 담백하고 신뢰가는 톤.
- 진단·처방처럼 단정하지 말고, 실천 가능한 정보와 따뜻한 시선으로 마무리.
- 반드시 순수 JSON 객체 하나만 출력하세요(설명 문장, 코드펜스 없이).
JSON 스키마:
{
  "chosen_index": number, // 후보 중 카드뉴스로 만들 하나의 인덱스
  "kicker": string, // 8자 내외 카테고리 라벨, 예: "오늘의 건강 이야기"
  "title": string, // 표지 헤드라인, 18자 내외, 줄바꿈 가능
  "slides": [ { "heading": string, "body": string } ], // 정확히 3개, heading은 12자 내외, body는 1~2문장
  "reflection": string, // "건강에 대한 고찰" 2~3문장, 따뜻하고 담백한 마무리
  "caption": string, // 인스타그램 캡션: 첫 줄은 후킹 문장, 이후 2~3문장 설명, "저장해두고 필요할 때 다시 보세요" 류의 저장 유도 한 줄, 마지막에 해시태그 5~8개(넓은 태그 #건강 + 좁은 태그 예: #시니어건강 + 브랜드 태그 #보미건강노트 조합)
  "cover_image_prompt_en": string // 표지 사진 생성을 위한 영어 프롬프트. 사람/사물/장면 묘사만, 텍스트나 글자는 절대 넣지 말 것
}`;

async function pickAndWriteCardnews(candidates) {
  const list = candidates
    .map((c, i) => `${i}. [${c.source}] ${c.title}\n${(c.description || '').slice(0, 220)}`)
    .join('\n\n');
  const userPrompt = `다음은 오늘 수집된 건강/의료 뉴스 후보입니다. 이 중 시니어 독자에게 가장 유용하고 담백하게 풀어낼 수 있는 주제 하나를 골라 카드뉴스 대본을 JSON으로 작성하세요.\n\n${list}`;
  const reply = await callAI(COPY_SYSTEM_PROMPT, [{ role: 'user', content: userPrompt }], { maxTokens: 1400 });
  const parsed = parseJsonLoose(reply);
  if (!parsed.chosen_index && parsed.chosen_index !== 0) throw new Error('LLM 응답에 chosen_index가 없어요.');
  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) throw new Error('LLM 응답에 slides가 없어요.');
  return parsed;
}

async function handleCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: '인증 실패 — CRON_SECRET 환경변수를 설정하고 Vercel Cron이 자동으로 붙이는 Authorization 헤더로만 호출되어야 해요.' });
    return;
  }

  const recentUrls = new Set(await listRecentCardnewsSourceUrls(14));
  const candidates = await fetchHealthTopicCandidates(recentUrls, 8);
  if (candidates.length === 0) {
    res.status(200).json({ ok: true, skipped: true, reason: '새로운 건강 뉴스 후보가 없어요(최근 14일 내 중복 제외).' });
    return;
  }

  const copy = await pickAndWriteCardnews(candidates);
  const chosen = candidates[copy.chosen_index] || candidates[0];

  // 표지 사진 생성 실패해도 전체 파이프라인은 계속 진행합니다(타이포그래피 전용
  // 표지로 폴백) — OpenAI 장애/쿼터 초과가 매일의 카드뉴스 자체를 막지 않도록.
  let coverImageB64 = null;
  try {
    coverImageB64 = await generateCoverImageB64(copy.cover_image_prompt_en);
  } catch (e) {
    coverImageB64 = null;
  }

  const slides = [
    { kind: 'title', kicker: copy.kicker, heading: copy.title, dateLabel: kstDateLabel(), coverImageB64 },
    ...copy.slides.map(s => ({ kind: 'content', heading: s.heading, body: s.body })),
    { kind: 'reflection', heading: '오늘의 건강 고찰', body: copy.reflection },
  ];

  const draft = await createCardnewsDraft({
    topic_title: copy.title,
    source_url: chosen.link,
    source_name: chosen.source,
    slides,
    caption: copy.caption,
    status: 'pending',
  });

  const baseUrl = resolveBaseUrl(req);
  const imageUrls = slideRenderUrls(baseUrl, draft.id, slides.length);

  await sendCardnewsPreview({
    imageUrls,
    captionText: `<b>${copy.title}</b>\n원문: ${chosen.source}`,
  });
  await sendApprovalPrompt({
    text: '이 카드뉴스, 인스타그램에 올릴까요?',
    draftId: draft.id,
  });

  res.status(200).json({ ok: true, draftId: draft.id, topic: copy.title });
}

async function handleRender(req, res) {
  const { id, slide } = req.query || {};
  if (!id || slide === undefined) {
    res.status(400).json({ error: 'id, slide 쿼리 파라미터가 필요해요.' });
    return;
  }
  const index = Number(slide);
  const draft = await getCardnewsDraft(id);
  if (!draft || !Array.isArray(draft.slides) || !draft.slides[index]) {
    res.status(404).json({ error: '카드뉴스 초안을 찾을 수 없어요.' });
    return;
  }
  const png = await renderSlidePng(draft.slides[index], index, draft.slides.length);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.status(200).send(Buffer.from(png));
}

async function handleWebhook(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 가능해요.' });
    return;
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    res.status(401).json({ error: '인증 실패 — TELEGRAM_WEBHOOK_SECRET 확인.' });
    return;
  }

  const cq = (req.body || {}).callback_query;
  if (!cq) {
    res.status(200).json({ ok: true }); // 콜백 버튼이 아닌 업데이트는 무시
    return;
  }

  const [action, draftId] = String(cq.data || '').split(':');
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const draft = await getCardnewsDraft(draftId);

  if (!draft) {
    await answerCallbackQuery(cq.id, '초안을 찾을 수 없어요.');
    res.status(200).json({ ok: true });
    return;
  }
  if (draft.status !== 'pending') {
    await answerCallbackQuery(cq.id, `이미 처리됨: ${draft.status}`);
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'reject') {
    await updateCardnewsDraft(draftId, { status: 'rejected' });
    await answerCallbackQuery(cq.id, '거절했어요.');
    await editMessageText({ chatId, messageId, text: `❌ 거절됨: ${draft.topic_title}` });
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'approve') {
    await answerCallbackQuery(cq.id, '업로드를 시작할게요…');
    const baseUrl = resolveBaseUrl(req);
    const imageUrls = slideRenderUrls(baseUrl, draftId, draft.slides.length);
    try {
      const mediaId = await publishCarousel({ imageUrls, caption: draft.caption });
      await updateCardnewsDraft(draftId, { status: 'published', ig_media_id: mediaId, published_at: new Date().toISOString() });
      await editMessageText({ chatId, messageId, text: `✅ 업로드 완료: ${draft.topic_title}` });
    } catch (e) {
      await updateCardnewsDraft(draftId, { status: 'failed', error_message: e.message });
      await editMessageText({ chatId, messageId, text: `⚠️ 업로드 실패: ${draft.topic_title}\n${e.message}` });
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'render') return await handleRender(req, res);
    if (action === 'cron') return await handleCron(req, res);
    if (action === 'webhook') return await handleWebhook(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요 (render | cron | webhook).' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
