// 사주팔자(四柱八字) 네 기둥(년/월/일/시주) 계산.
//
// 출처: bazi-calculator-by-alvamind(MIT License, https://github.com/alvamind/bazi-calculator-by-alvamind)
// 오픈소스의 핵심 계산 로직(절기 반영 만세력 조회 테이블 + 오서둔 시주 공식)을
// 그대로 가져와 플레인 JS(ESM)로 옮겼습니다. 원본 npm 패키지(v1.0.2)는 실제
// 게시물에 dist 빌드 산출물이 빠져있어 설치해도 동작하지 않는 상태라(README와
// 실제 배포물이 어긋남), TypeScript 빌드 단계를 새로 들이는 대신 검증한 소스만
// 옮겨왔습니다. lib/data/bazi-date-mapping.json도 같은 저장소(src/dates_mapping.json,
// 1930~2048년 데이터)에서 그대로 가져온 것입니다.
//
// 중요한 한계: 이 계산은 "양력(그레고리력)" 생년월일 기준입니다. 음력 생일은
// 정확한 계산을 위해 먼저 양력으로 변환해야 하는데(한국천문연구원 KASI
// 음양력 변환 API 등 별도 연동 필요), 지금은 그 변환 단계가 없어서
// calculateBaziPillars는 음력 날짜에 그대로 쓰면 틀린 결과를 줍니다 — 호출부
// (api/chat.js)에서 양력일 때만 호출하세요.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dateMappings = null;
function loadDateMappings() {
  if (!dateMappings) {
    const raw = readFileSync(path.join(__dirname, 'data', 'bazi-date-mapping.json'), 'utf-8');
    dateMappings = JSON.parse(raw);
  }
  return dateMappings;
}

const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const STEMS_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const BRANCHES_HANJA = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
// 갑을=목, 병정=화, 무기=토, 경신=금, 임계=수 (천간 순서 그대로 오행 매핑)
const ELEMENTS_BY_STEM = ['목', '목', '화', '화', '토', '토', '금', '금', '수', '수'];
// [시작시각, 끝시각(미만), 지지 인덱스] — 자시만 23시~다음날 1시로 자정을 걸침
const HOUR_MAP = [
  [23, 1, 0], [1, 3, 1], [3, 5, 2], [5, 7, 3], [7, 9, 4], [9, 11, 5],
  [11, 13, 6], [13, 15, 7], [15, 17, 8], [17, 19, 9], [19, 21, 10], [21, 23, 11],
];

function hourToBranchIndex(hour) {
  const found = HOUR_MAP.find(([start, end]) =>
    (hour >= start && hour < end) || (start === 23 && (hour >= 23 || hour < 1))
  );
  return found ? found[2] : 0;
}

function pillarFromIndices(stemIdx, branchIdx) {
  return {
    label: STEMS[stemIdx] + BRANCHES[branchIdx],
    hanja: STEMS_HANJA[stemIdx] + BRANCHES_HANJA[branchIdx],
    element: ELEMENTS_BY_STEM[stemIdx],
    animal: ANIMALS[branchIdx],
  };
}

// year/month/day: 양력(그레고리력) 기준. hour: 0~23 정수 또는 null(모를 때, 시주 생략).
// 반환값이 null이면 조회 테이블 범위(1930~2048년) 밖이거나 잘못된 날짜입니다.
export function calculateBaziPillars({ year, month, day, hour }) {
  const mappings = loadDateMappings();
  const yearData = mappings[String(year)];
  const monthData = yearData && yearData[String(month)];
  const dayData = monthData && monthData[String(day)];
  if (!dayData) return null;

  const yearPillar = pillarFromIndices(Number(dayData.HYear) - 1, Number(dayData.EYear) - 1);
  const monthPillar = pillarFromIndices(Number(dayData.HMonth) - 1, Number(dayData.EMonth) - 1);
  const dayPillar = pillarFromIndices(Number(dayData.HDay) - 1, Number(dayData.EDay) - 1);

  let hourPillar = null;
  if (hour !== null && hour !== undefined) {
    const hourBranchIdx = hourToBranchIndex(hour);
    // 오서둔(五鼠遁) 공식: 일간 인덱스*2 + 시지 인덱스, mod 10
    const hourStemIdx = ((Number(dayData.HDay) - 1) * 2 + hourBranchIdx) % 10;
    hourPillar = pillarFromIndices(hourStemIdx, hourBranchIdx);
  }

  return { year: yearPillar, month: monthPillar, day: dayPillar, hour: hourPillar };
}

// AI 시스템 프롬프트에 그대로 붙여 넣을 한국어 한 줄 요약.
export function describeBaziPillarsKorean(pillars) {
  if (!pillars) return null;
  const parts = [
    `년주 ${pillars.year.label}(${pillars.year.element}, ${pillars.year.animal}띠)`,
    `월주 ${pillars.month.label}(${pillars.month.element})`,
    `일주 ${pillars.day.label}(${pillars.day.element}, 사주에서 '나'를 나타내는 일간)`,
  ];
  if (pillars.hour) parts.push(`시주 ${pillars.hour.label}(${pillars.hour.element})`);
  return parts.join(', ');
}
