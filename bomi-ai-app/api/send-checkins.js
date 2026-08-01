// Vercel Cron이 매시 정각에 호출합니다 (vercel.json 참고). 활성화된 회원마다
// 수면/식사/활동/기분 4개 항목의 설정 시각을 확인해서, 지금이 그 시각(KST, 시
// 단위)이면 해당 안부 문자를 보냅니다.
//
// 시간 비교를 "시(hour)" 단위로만 하는 이유: Cron이 정시(0분)에만 실행되므로
// 분 단위까지 맞출 필요가 없고, 회원이 설정 화면에서 분 단위로 입력해도 그
// 시각이 속한 시간에 보내집니다(예: 10:30으로 설정해도 10시 정각에 발송).
import { listEnabledCheckinSettings, getPushSubscription } from '../lib/supabaseAdmin.mjs';
import { sendPush } from '../lib/push.mjs';

// 각 항목은 자기만의 enabled 플래그(enabledField)를 가져서, 안부 문자 전체를
// 꺼도 건강리포트 알림만 따로 켜둘 수 있습니다(반대도 가능). 건강리포트는
// type이 달라서(health_report_ready) sw.js가 알림을 탭했을 때 채팅이 아니라
// 리포트 화면(광고/구독 게이트)으로 바로 이동시킵니다.
const NOTIF_FIELDS = [
  { timeField: 'sleep_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '간밤에 잘 주무셨어요? 오늘 컨디션이 궁금해요.' },
  { timeField: 'meal_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '오늘 식사는 잘 챙기셨나요? 어떠셨는지 들려주세요.' },
  { timeField: 'activity_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '오늘은 어떤 운동이나 활동을 하셨을까요?' },
  { timeField: 'mood_time', enabledField: 'enabled', type: 'checkin', title: '보미가 안부를 물어요', body: '평안한 하루 보내고 계신가요? 지금 기분이나 컨디션은 어떠세요?' },
  { timeField: 'report_time', enabledField: 'report_enabled', type: 'health_report_ready', title: '오늘의 건강리포트가 나왔어요', body: '광고를 보거나 구독하면 바로 확인하실 수 있어요.' },
];

function currentKstHour() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST
  return kst.getUTCHours();
}

export default async function handler(req, res) {
  // Vercel Cron은 GET으로 호출합니다. 수동 테스트도 GET으로 가능하게 둡니다.
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 요청만 가능해요.' });
    return;
  }
  try {
    const hour = currentKstHour();
    const settingsList = await listEnabledCheckinSettings();
    let sent = 0;
    let failed = 0;
    let matched = 0;

    for (const s of settingsList || []) {
      for (const field of NOTIF_FIELDS) {
        if (!s[field.enabledField]) continue;
        const configuredHour = parseInt((s[field.timeField] || '').split(':')[0], 10);
        if (configuredHour !== hour) continue;
        matched += 1;
        const sub = await getPushSubscription(s.bomi_link_code);
        if (!sub) continue;
        try {
          await sendPush(sub.subscription, {
            type: field.type,
            title: field.title,
            body: field.body,
          });
          sent += 1;
        } catch (e) {
          // 만료/취소된 구독은 정상적인 상황 — 전체 배치를 막지 않고 건너뜀.
          failed += 1;
        }
      }
    }
    res.status(200).json({ ok: true, hour, matched, sent, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
