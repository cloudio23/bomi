// api/chat.js(카운트 증가)와 api/usage.js(조회)가 정확히 같은 "오늘" 기준을
// 쓰도록 날짜 키 계산을 한 곳에 둡니다 — 서버는 UTC로 도네, 사용자는 한국
// 시간 기준 "오늘"을 기대하므로 KST(UTC+9)로 보정합니다.
export function todayKeyKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 다음 KST 자정까지 남은 분 — 원형게이지 상세창의 "몇 분 후 초기화" 표시용.
export function minutesUntilKstMidnight() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const nextMidnightKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1);
  return Math.round((nextMidnightKst - kst.getTime()) / 60000);
}
