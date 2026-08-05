// 헤더의 "대화 가능량" 원형게이지가 읽어가는 엔드포인트.
//
// 중요: 이건 Gemini(구글)가 실제로 보고하는 실시간 잔여 할당량이 아닙니다 —
// 무료 티어 API는 그런 조회 기능 자체를 제공하지 않아서(한도를 넘겨야 비로소
// 에러로 알게 됨), 대신 저희가 api/chat.js에서 직접 센 "오늘 요청 수"를 아래
// DAILY_CHAT_BUDGET(자체적으로 정한 하루 목표치)과 비교해서 보여줍니다.
// Google이 공개한 gemini-2.5-flash 무료 티어 한도(문서상 하루 약 250건, 단
// "보장되지 않음"이라고 명시)보다 안전하게 낮춰 잡은 기본값입니다 — 실제
// 상황에 맞게 DAILY_CHAT_BUDGET 환경변수로 조정하세요.
//
// 필요한 Supabase 테이블(README나 대화에서 안내한 SQL로 미리 생성 필요):
//   bomi_usage_daily(usage_date date primary key, request_count integer, updated_at timestamptz)
import { getDailyUsage } from '../lib/supabaseAdmin.mjs';
import { todayKeyKST, minutesUntilKstMidnight } from '../lib/usage.mjs';

const DAILY_BUDGET = Number(process.env.DAILY_CHAT_BUDGET || 200);

export default async function handler(req, res) {
  try {
    const used = await getDailyUsage(todayKeyKST());
    const remaining = Math.max(0, DAILY_BUDGET - used);
    const remainingPercent = Math.round((remaining / DAILY_BUDGET) * 100);
    res.status(200).json({
      ok: true,
      used,
      budget: DAILY_BUDGET,
      remaining,
      remainingPercent,
      resetInMinutes: minutesUntilKstMidnight(),
    });
  } catch (e) {
    res.status(200).json({ ok: false, message: '사용량 정보를 확인하지 못했어요.' });
  }
}
