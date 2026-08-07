// 달력 일정 CRUD.
//
// - GET  ?action=list&code=...&month=YYYY-MM        → 한 달치 일정 조회
// - GET  ?action=today&code=...&date=YYYY-MM-DD      → 특정 날짜 일정만(체크리스트 위젯용)
// - POST ?action=add    {bomiLinkCode, eventDate, title, startTime, endTime, alarmEnabled} → 일정 추가
// - POST ?action=delete {bomiLinkCode, id}            → 일정 삭제
//
// 알람(푸시 알림)은 api/notifications.js의 ?action=checkins가 매시 정각 호출될
// 때 이 테이블도 같이 확인해서 보냅니다(새 스케줄러를 따로 안 만들어도 되도록).
//
// 필요한 Supabase 테이블(안내한 SQL로 미리 생성 필요):
//   bomi_calendar_events(
//     id uuid primary key default gen_random_uuid(),
//     bomi_link_code text not null,
//     event_date date not null,
//     title text not null,
//     start_time time,
//     end_time time,
//     alarm_enabled boolean not null default false,
//     alarm_sent boolean not null default false,
//     created_at timestamptz not null default now()
//   )
import { listCalendarEvents, addCalendarEvent, deleteCalendarEvent, listCalendarEventsForDate } from '../lib/supabaseAdmin.mjs';

function nextMonthPrefix(month) {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // m(0-indexed 다음달)
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

async function handleList(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' }); return; }
  const code = (req.query && req.query.code) || '';
  const month = (req.query && req.query.month) || ''; // "YYYY-MM"
  if (!code || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ ok: false, message: 'code와 month(YYYY-MM)가 필요해요.' });
    return;
  }
  try {
    const rows = await listCalendarEvents(code, `${month}-01`, nextMonthPrefix(month));
    res.status(200).json({ ok: true, events: rows || [] });
  } catch (e) {
    res.status(200).json({ ok: false, message: '일정을 불러오지 못했어요.' });
  }
}

async function handleToday(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ ok: false, message: 'GET 요청만 가능해요.' }); return; }
  const code = (req.query && req.query.code) || '';
  const date = (req.query && req.query.date) || '';
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ ok: false, message: 'code와 date(YYYY-MM-DD)가 필요해요.' });
    return;
  }
  try {
    const rows = await listCalendarEventsForDate(code, date);
    res.status(200).json({ ok: true, events: rows || [] });
  } catch (e) {
    res.status(200).json({ ok: false, message: '일정을 불러오지 못했어요.' });
  }
}

async function handleAdd(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' }); return; }
  const { bomiLinkCode, eventDate, title, startTime, endTime, alarmEnabled } = req.body || {};
  if (!bomiLinkCode || !eventDate || !title || !title.trim()) {
    res.status(400).json({ ok: false, message: 'bomiLinkCode, eventDate, title이 필요해요.' });
    return;
  }
  try {
    const rows = await addCalendarEvent(bomiLinkCode, { eventDate, title: title.trim(), startTime, endTime, alarmEnabled });
    res.status(200).json({ ok: true, event: rows && rows[0] });
  } catch (e) {
    res.status(200).json({ ok: false, message: '일정을 저장하지 못했어요.' });
  }
}

async function handleDelete(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: 'POST 요청만 가능해요.' }); return; }
  const { bomiLinkCode, id } = req.body || {};
  if (!bomiLinkCode || !id) {
    res.status(400).json({ ok: false, message: 'bomiLinkCode, id가 필요해요.' });
    return;
  }
  try {
    await deleteCalendarEvent(bomiLinkCode, id);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, message: '일정을 삭제하지 못했어요.' });
  }
}

export default async function handler(req, res) {
  try {
    const action = (req.query && req.query.action) || '';
    if (action === 'list') return await handleList(req, res);
    if (action === 'today') return await handleToday(req, res);
    if (action === 'add') return await handleAdd(req, res);
    if (action === 'delete') return await handleDelete(req, res);
    res.status(400).json({ error: 'action 쿼리 파라미터가 필요해요 (list | today | add | delete).' });
  } catch (e) {
    res.status(500).json({ ok: false, message: '요청 처리 중 문제가 생겼어요.' });
  }
}
