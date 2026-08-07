// 건강 안부 문자 on/off 및 4개 시간(수면/식사/활동/기분) + 건강리포트 알림 시간
// 설정을 읽고 저장합니다. wakeTime/mealCount/breakfastTime/lunchTime/dinnerTime은
// 온보딩에서 한 번 받아 저장되는 값 — 보내지 않으면 기존 값을 그대로 둡니다
// (sleepTime 등 기존 4개와 달리 자연스러운 기본값이 없어서 별도 처리).
// GET  ?code=... → 현재 설정 조회
// POST { bomiLinkCode, enabled, reportEnabled, reportTime, sleepTime, mealTime,
//        activityTime, moodTime, wakeTime, mealCount, breakfastTime, lunchTime, dinnerTime } → 저장
import { getCheckinSettings, upsertCheckinSettings } from '../lib/supabaseAdmin.mjs';

const DEFAULTS = {
  enabled: true, report_enabled: true, report_time: '21:00',
  sleep_time: '10:00', meal_time: '19:00', activity_time: '17:00', mood_time: '20:00',
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
        bomiLinkCode, enabled, reportEnabled, reportTime, sleepTime, mealTime, activityTime, moodTime,
        wakeTime, mealCount, breakfastTime, lunchTime, dinnerTime,
      } = req.body || {};
      if (!bomiLinkCode) {
        res.status(400).json({ error: 'bomiLinkCode가 필요해요.' });
        return;
      }
      const settings = {
        enabled: enabled !== undefined ? !!enabled : DEFAULTS.enabled,
        report_enabled: reportEnabled !== undefined ? !!reportEnabled : DEFAULTS.report_enabled,
        report_time: reportTime || DEFAULTS.report_time,
        sleep_time: sleepTime || DEFAULTS.sleep_time,
        meal_time: mealTime || DEFAULTS.meal_time,
        activity_time: activityTime || DEFAULTS.activity_time,
        mood_time: moodTime || DEFAULTS.mood_time,
      };
      // 기상/식사 스케줄은 값이 실제로 왔을 때만 갱신 — 안 보내면 기존 값 유지.
      if (wakeTime !== undefined) settings.wake_time = wakeTime || null;
      if (mealCount !== undefined) settings.meal_count = mealCount || null;
      if (breakfastTime !== undefined) settings.breakfast_time = breakfastTime || null;
      if (lunchTime !== undefined) settings.lunch_time = lunchTime || null;
      if (dinnerTime !== undefined) settings.dinner_time = dinnerTime || null;
      await upsertCheckinSettings(bomiLinkCode, settings);
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'GET 또는 POST 요청만 가능해요.' });
}
