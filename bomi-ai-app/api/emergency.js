// 비상연락처 관리 + 보이스피싱 의심 알림 문자.
// GET  ?action=contacts&code=...                                  → 연락처 목록
// POST ?action=add-contact    { bomiLinkCode, name, phone, relation } → 연락처 추가
// POST ?action=delete-contact { bomiLinkCode, id }                 → 연락처 삭제
// POST ?action=alert          { bomiLinkCode, userName }           → 등록된 모든 연락처에
//   "보이스피싱 의심" 알림 문자 발송(lib/sms.mjs, SOLAPI 발신번호 미설정이면 ok:false로
//   조용히 실패해서 클라이언트가 "직접 전화하라"는 안내로 대체함).
import {
  listEmergencyContacts,
  addEmergencyContact,
  deleteEmergencyContact,
} from '../lib/supabaseAdmin.mjs';
import { sendSms } from '../lib/sms.mjs';

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || '';

  if (req.method === 'GET' && action === 'contacts') {
    try {
      const code = (req.query && req.query.code) || '';
      if (!code) {
        res.status(400).json({ error: 'code가 필요해요.' });
        return;
      }
      const contacts = await listEmergencyContacts(code);
      res.status(200).json({ ok: true, contacts: contacts || [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && action === 'add-contact') {
    try {
      const { bomiLinkCode, name, phone, relation } = req.body || {};
      if (!bomiLinkCode || !name || !phone) {
        res.status(400).json({ error: 'bomiLinkCode, name, phone이 필요해요.' });
        return;
      }
      const rows = await addEmergencyContact(bomiLinkCode, { name, phone, relation });
      res.status(200).json({ ok: true, contact: rows && rows[0] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && action === 'delete-contact') {
    try {
      const { bomiLinkCode, id } = req.body || {};
      if (!bomiLinkCode || !id) {
        res.status(400).json({ error: 'bomiLinkCode, id가 필요해요.' });
        return;
      }
      await deleteEmergencyContact(bomiLinkCode, id);
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === 'POST' && action === 'alert') {
    try {
      const { bomiLinkCode, userName } = req.body || {};
      if (!bomiLinkCode) {
        res.status(400).json({ error: 'bomiLinkCode가 필요해요.' });
        return;
      }
      const contacts = await listEmergencyContacts(bomiLinkCode);
      if (!contacts || contacts.length === 0) {
        res.status(200).json({ ok: true, sentCount: 0, noContacts: true });
        return;
      }
      const name = userName || '어르신';
      const text = `[보미] ${name}님이 방금 보이스피싱이 의심되는 상황에 있다고 알려왔어요. 지금 바로 연락해서 상황을 확인해 주세요.`;
      const results = await Promise.all(contacts.map((c) => sendSms(c.phone, text)));
      const sentCount = results.filter((r) => r.ok).length;
      res.status(200).json({ ok: true, sentCount, failedCount: results.length - sentCount });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(400).json({ error: '알 수 없는 action이에요.' });
}
