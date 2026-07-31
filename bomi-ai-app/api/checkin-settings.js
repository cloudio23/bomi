// 건강 안부 문자 on/off 및 4개 시간(수면/식사/활동/기분) 설정을 읽고 저장합니다.
// GET  ?code=... → 현재 설정 조회
// POST { bomiLinkCode, enabled, sleepTime, mealTime, activityTime, moodTime } → 저장
import { getCheckinSettings, upsertCheckinSettings } from '../lib/supabaseAdmin.mjs';

const DEFAULTS = { enabled: true, sleep_time: '10:00', meal_time: '19:00', activity_time: '17:00', mood_time: '20:00' };

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
      const { bomiLinkCode, enabled, sleepTime, mealTime, activityTime, moodTime } = req.body || {};
      if (!bomiLinkCode) {
        res.status(400).json({ error: 'bomiLinkCode가 필요해요.' });
        return;
      }
      await upsertCheckinSettings(bomiLinkCode, {
        enabled: enabled !== undefined ? !!enabled : DEFAULTS.enabled,
        sleep_time: sleepTime || DEFAULTS.sleep_time,
        meal_time: mealTime || DEFAULTS.meal_time,
        activity_time: activityTime || DEFAULTS.activity_time,
        mood_time: moodTime || DEFAULTS.mood_time,
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'GET 또는 POST 요청만 가능해요.' });
}
