// Vercel Cron이 매일 정해진 시각에 호출합니다 (vercel.json 참고). 앱을 안 열어도
// 카톡처럼 먼저 말을 거는 느낌을 주기 위한 푸시 — CRM 연동 여부와 무관하게
// 등록된 모든 보미 사용자에게 보냅니다.
//
// 지금은 일부러 일반적인 문구만 보냅니다 — 회원 이름/실제 건강 신호로 개인화
// 하려면 보미 쪽에도 이름 등 최소 프로필을 서버에 저장해야 하는데, 지금은
// 그 범위까지 넣지 않았습니다(로컬 전용 프로필 원칙 유지). 나중에 인사말을
// 개인화하고 싶어지면 여기와 lib/supabaseAdmin.mjs를 같이 확장하면 됩니다.
import { listAllPushSubscriptions } from '../lib/supabaseAdmin.mjs';
import { sendPush } from '../lib/push.mjs';

const GREETINGS = [
  '오늘 컨디션은 어떠세요? 궁금한 게 있으면 편하게 말 걸어주세요.',
  '좋은 아침이에요! 오늘 하루도 잘 보내고 계신가요?',
  '어젯밤엔 푹 주무셨나요? 오늘 있었던 일도 들려주세요.',
];

function pickGreeting() {
  const dayIndex = new Date().getDate() % GREETINGS.length;
  return GREETINGS[dayIndex];
}

export default async function handler(req, res) {
  // Vercel Cron은 GET으로 호출합니다. 수동 테스트도 GET으로 가능하게 둡니다.
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  try {
    const subs = await listAllPushSubscriptions();
    const body = pickGreeting();
    let sent = 0;
    let failed = 0;
    for (const row of subs || []) {
      try {
        await sendPush(row.subscription, {
          type: 'daily_greeting',
          title: '보미가 안부를 물어요',
          body,
        });
        sent += 1;
      } catch (e) {
        // 만료/취소된 구독은 발송 실패가 정상적인 상황 — 전체 배치를 막지 않고 건너뜀.
        failed += 1;
      }
    }
    res.status(200).json({ ok: true, total: (subs || []).length, sent, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
