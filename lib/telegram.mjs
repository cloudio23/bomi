// 카드뉴스 승인/거절 검토용 Telegram Bot 헬퍼 (창업자 선택: "텔레그램 봇으로 검토").
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 필요 — 발급 방법은 INSTAGRAM_SETUP.md 참고.
const API_BASE = 'https://api.telegram.org';

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN 환경변수가 설정되어 있지 않아요.');
  return token;
}

async function call(method, payload) {
  const res = await fetch(`${API_BASE}/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method} 실패: ${data.description || res.status}`);
  return data.result;
}

function targetChatId(explicitChatId) {
  const chatId = explicitChatId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID 환경변수가 설정되어 있지 않아요.');
  return chatId;
}

// imageUrls는 api/cardnews/render.js가 서빙하는 공개 URL — Telegram 서버가 직접
// fetch해서 앨범으로 보여주므로 여기서 이미지를 직접 업로드할 필요가 없습니다.
export async function sendCardnewsPreview({ chatId, imageUrls, captionText }) {
  const media = imageUrls.map((url, i) => ({
    type: 'photo',
    media: url,
    ...(i === 0 ? { caption: captionText, parse_mode: 'HTML' } : {}),
  }));
  return call('sendMediaGroup', { chat_id: targetChatId(chatId), media });
}

export async function sendApprovalPrompt({ chatId, text, draftId }) {
  return call('sendMessage', {
    chat_id: targetChatId(chatId),
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ 승인하고 업로드', callback_data: `approve:${draftId}` },
        { text: '❌ 거절', callback_data: `reject:${draftId}` },
      ]],
    },
  });
}

export async function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });
}

export async function editMessageText({ chatId, messageId, text }) {
  return call('editMessageText', { chat_id: targetChatId(chatId), message_id: messageId, text });
}

export async function sendMessage(text, chatId) {
  return call('sendMessage', { chat_id: targetChatId(chatId), text });
}
