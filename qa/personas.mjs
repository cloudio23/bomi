// Elderly test personas for the Bomi AI QA harness.
// Each maps to a real segment named in the pitch deck (Bomi AI 초기창업패키지 PSST.pptx.pdf):
//   - kimMalsoon  -> deck cover demo (무릎 통증, 트로트/손주 관심사)
//   - parkJungsoo -> slide 4/7 dementia & MCI reminder scenario
//   - leeSoonja   -> slide 2 (23시간 방치, 고독)
//   - choiYeonggam-> slide 3 (복잡한 UI/정보검색 포기, 낮은 디지털 리터러시)
//   - jungOkhee   -> slide 4 (치매 중기 근접, 반복 질문 경향)
//
// `checklistItems` / `checklistState` feed straight into buildSystemPrompt(),
// exactly like `checklistItems` / `checklistState` in index.html.

export const personas = [
  {
    id: 'kimMalsoon',
    profile: {
      name: '김말순', birthYear: 1948, gender: '여성',
      height: 152, weight: 58,
      interests: ['트로트', '손주', '화초 가꾸기'],
    },
    techLiteracy: 'medium',
    cognitiveRisk: 'none',
    notes: '무릎 통증으로 병원 다녀온 지 얼마 안 됨. 활발하고 수다스러운 편.',
    checklistItems: [
      { id: 'med_am', label: '오전 08:00 혈압약 복용' },
      { id: 'lunch', label: '오후 01:00 점심 식사' },
      { id: 'walk', label: '오후 04:00 산책 30분' },
    ],
    checklistState: { med_am: true, lunch: false, walk: false },
  },
  {
    id: 'parkJungsoo',
    profile: {
      name: '박정수', birthYear: 1944, gender: '남성',
      height: 168, weight: 64,
      interests: ['바둑', '뉴스'],
    },
    techLiteracy: 'low',
    cognitiveRisk: 'mci_early', // 경도인지장애 초기
    notes: '복약 여부를 자주 잊어버리고 불안해함. 슬라이드 7 리마인드 시나리오의 실제 대상.',
    checklistItems: [
      { id: 'med_am', label: '오전 08:00 혈압약 복용' },
      { id: 'lunch', label: '오후 01:00 점심 식사' },
    ],
    checklistState: { med_am: true, lunch: false },
  },
  {
    id: 'leeSoonja',
    profile: {
      name: '이순자', birthYear: 1951, gender: '여성',
      height: 149, weight: 51,
      interests: ['라디오 사연', '화초'],
    },
    techLiteracy: 'medium',
    cognitiveRisk: 'none',
    notes: '배우자 사별 후 혼자 거주. 슬라이드 2 "방치된 23시간" / 정서적 고립 대상.',
    checklistItems: [
      { id: 'walk', label: '오후 02:00 동네 산책' },
    ],
    checklistState: { walk: false },
  },
  {
    id: 'choiYeonggam',
    profile: {
      name: '최영감', birthYear: 1957, gender: '남성',
      height: 171, weight: 70,
      interests: ['등산', '막내아들'],
    },
    techLiteracy: 'very_low',
    cognitiveRisk: 'none',
    notes: '스마트폰을 최근에서야 쓰기 시작함. 복잡한 절차/용어에 거부감 큼. 슬라이드 3 Zero UI 대상.',
    checklistItems: [
      { id: 'med_pm', label: '오후 07:00 저녁약 복용' },
    ],
    checklistState: { med_pm: false },
  },
  {
    id: 'jungOkhee',
    profile: {
      name: '정옥희', birthYear: 1940, gender: '여성',
      height: 155, weight: 55,
      interests: ['손주', '화투'],
    },
    techLiteracy: 'low',
    cognitiveRisk: 'mci_advancing', // 치매 중기에 가까운 경도인지장애
    notes: '같은 질문을 짧은 시간 안에 반복하는 경향. 슬라이드 4 통계상 85세 이상 여성군(28.34%) 대표.',
    checklistItems: [
      { id: 'med_am', label: '오전 08:00 혈압약 복용' },
      { id: 'med_pm', label: '오후 07:00 저녁약 복용' },
    ],
    checklistState: { med_am: true, med_pm: false },
  },
];
