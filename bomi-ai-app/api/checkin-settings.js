// 건강 안부 문자 설정을 읽고 저장합니다. 5개 카테고리(건강리포트/수면/식사
// 3끼/활동/기분)가 각각 독립적으로 켜고 끌 수 있고 각자 시간을 가집니다 —
// 예전엔 sleep/meal/activity/mood가 "enabled" 하나로 다 같이 켜지고 꺼졌는데,
// "아침·점심은 끄고 저녁만 받고 싶다"처럼 항목별로 다르게 쓰고 싶다는 요청으로
// 세분화했습니다. activityMode는 'auto'(걸음수 연동, 알림 없이 조용히 반영) 또는
// 'manual'(정해진 시간에 직접 입력하라고 알림) — 연동 여부와 무관하게 회원이 고를
// 수 있습니다.
// wakeTime/mealCount는 온보딩에서 한 번 받아 저장되는 참고용 값 — 보내지
// 않으면 기존 값을 그대로 둡니다.
// GET  ?code=... → 현재 설정 조회
// POST { bomiLinkCode, reportEnabled, reportTime, sleepEnabled, sleepTime,
//        breakfastEnabled, breakfastTime, lunchEnabled, lunchTime,
//        dinnerEnabled, dinnerTime, activityMode, activityTime,
//        moodEnabled, moodTime, wakeTime, mealCount } → 저장
import { getCheckinSettings, upsertCheckinSettings } from '../lib/supabaseAdmin.mjs';

const DEFAULTS = {
  enabled: true,
  report_enabled: true, report_time: '21:00',
  sleep_enabled: true, sleep_time: '10:00',
  breakfast_enabled: true, breakfast_time: '08:00',
  lunch_enabled: true, lunch_time: '12:30',
  dinner_enabled: true, dinner_time: '18:30',
  activity_mode: 'auto', activity_time: '20:00',
  mood_enabled: true, mood_time: '20:00',
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const code = (req.query && req.query.code) || '';
      if (!code) {
        res.status(400).json({ error: 'code 쿼리 파라미터가 필요해요.' });
        return;
      }
      const row = await getCheckinSettings(code);
      res.status(200).json(row || { bomi_link_code: code, ...DEFAULTS });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const {
        bomiLinkCode,
        reportEnabled, reportTime,
        sleepEnabled, sleepTime,
        breakfastEnabled, breakfastTime,
        lunchEnabled, lunchTime,
        dinnerEnabled, dinnerTime,
        activityMode, activityTime,
        moodEnabled, moodTime,
        wakeTime, mealCount,
      } = req.body || {};
      if (!bomiLinkCode) {
        res.status(400).json({ error: 'bomiLinkCode가 필요해요.' });
        return;
      }
      const settings = {
        report_enabled: reportEnabled !== undefined ? !!reportEnabled : DEFAULTS.report_enabled,
        report_time: reportTime || DEFAULTS.report_time,
        sleep_enabled: sleepEnabled !== undefined ? !!sleepEnabled : DEFAULTS.sleep_enabled,
        sleep_time: sleepTime || DEFAULTS.sleep_time,
        breakfast_enabled: breakfastEnabled !== undefined ? !!breakfastEnabled : DEFAULTS.breakfast_enabled,
        breakfast_time: breakfastTime || DEFAULTS.breakfast_time,
        lunch_enabled: lunchEnabled !== undefined ? !!lunchEnabled : DEFAULTS.lunch_enabled,
        lunch_time: lunchTime || DEFAULTS.lunch_time,
        dinner_enabled: dinnerEnabled !== undefined ? !!dinnerEnabled : DEFAULTS.dinner_enabled,
        dinner_time: dinnerTime || DEFAULTS.dinner_time,
        activity_mode: activityMode === 'manual' ? 'manual' : DEFAULTS.activity_mode,
        activity_time: activityTime || DEFAULTS.activity_time,
        mood_enabled: moodEnabled !== undefined ? !!moodEnabled : DEFAULTS.mood_enabled,
        mood_time: moodTime || DEFAULTS.mood_time,
      };
      // 기상시간/끼니 수는 온보딩 참고용이라 값이 실제로 왔을 때만 갱신.
      if (wakeTime !== undefined) settings.wake_time = wakeTime || null;
      if (mealCount !== undefined) settings.meal_count = mealCount || null;
      await upsertCheckinSettings(bomiLinkCode, settings);
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'GET 또는 POST 요청만 가능해요.' });
}
