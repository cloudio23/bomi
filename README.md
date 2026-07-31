# 보미 AI - 배포 가이드

이 폴더 그대로 배포하면, 실제 인터넷 주소로 접속해서 홈 화면에 추가(PWA)할 수 있는
보미 AI가 됩니다. 개발 지식 없이도 따라 하실 수 있게 순서대로 적었어요.

전체적으로 **비용이 드는 부분**: 기본값은 **Gemini 무료 티어**라 검증 단계에서는 비용이
안 듭니다. 나중에 트래픽이 늘어 무료 티어가 부족해지면 `AI_PROVIDER=anthropic`으로
직접 전환할 수 있고, 그때부터는 Anthropic API가 사용한 만큼 과금됩니다(자동 전환 아님 —
직접 환경변수를 바꿔야 넘어가요). Vercel(호스팅)은 이 정도 규모면 무료 플랜으로 충분합니다.

---

## 1단계. Gemini API 키 발급받기 (기본, 무료)

1. https://aistudio.google.com/apikey 접속 → 구글 계정으로 로그인
2. **Create API key** 클릭 → 생성된 키를 복사해서 잘 저장해두세요.
3. 무료 티어 한도(모델별 분당/일일 호출 횟수 제한)는 Google AI Studio 문서에서 현재
   기준을 확인하세요 — 시간이 지나며 바뀔 수 있습니다.

### (나중에 필요할 때) Anthropic API 키 발급받기 — 무료 티어가 부족해지면

1. https://console.anthropic.com 접속 → 회원가입/로그인
2. 좌측 메뉴에서 **API Keys** → **Create Key** 클릭
3. 생성된 키(`sk-ant-...`로 시작)를 복사해서 저장. **Billing(결제)**에서 카드 등록/크레딧
   충전을 해야 실제 호출이 됩니다.
4. Vercel 환경변수에 `ANTHROPIC_API_KEY`를 추가하고 `AI_PROVIDER`를 `anthropic`으로
   바꾸면 그 즉시 Claude로 전환됩니다 (배포 재시작 없이 환경변수만 바꾸면 적용).

## 2단계. GitHub에 이 폴더 올리기

1. https://github.com 가입/로그인
2. 우측 상단 **+** → **New repository** → 이름 예: `bomi-ai` → Create
3. 생성된 저장소 페이지에서 **uploading an existing file** 클릭
4. 이 폴더 안의 파일 전체(`index.html`, `manifest.json`, `sw.js`, `icon-192.png`,
   `icon-512.png`, `api` 폴더 전체, `lib` 폴더 전체)를 드래그 앤 드롭으로 올리고
   **Commit changes** (Chrome에서는 폴더째로 드래그해도 구조가 유지돼요)

## 3단계. Vercel로 배포하기

1. https://vercel.com 접속 → **Continue with GitHub**로 로그인
2. **Add New... → Project** 클릭
3. 방금 만든 `bomi-ai` 저장소를 찾아 **Import**
4. **Environment Variables** 항목에 아래를 추가합니다.
   - Key: `GEMINI_API_KEY` / Value: 1단계에서 복사해둔 키 (필수, 기본 동작에 필요)
   - `AI_PROVIDER`, `ANTHROPIC_API_KEY`는 나중에 Claude로 전환할 때만 추가하면 됩니다.
5. **Deploy** 클릭 → 1~2분 기다리면 `https://bomi-ai-xxxx.vercel.app` 같은
   실제 주소가 생성됩니다.

## 4단계. 모바일에서 홈 화면에 추가 (PWA)

1. 생성된 주소를 어르신 스마트폰 브라우저(크롬/사파리)로 접속
2. **크롬(안드로이드)**: 우측 상단 점 3개 메뉴 → "홈 화면에 추가"
   **사파리(아이폰)**: 하단 공유 버튼(⬆️) → "홈 화면에 추가"
3. 홈 화면에 "보미" 아이콘이 생기고, 눌렀을 때 브라우저 주소창 없이 앱처럼 열립니다.

---

## 지금 이 배포 버전에서 실제로 되는 것 / 아직 안 되는 것

**됩니다**
- 실제 AI(기본 Gemini 무료 티어, 필요시 Claude로 전환)로 대화
- 온보딩, 체크리스트, 프로필, 건강리포트, 가족 리포트 미리보기, 피드백 질문
- 홈 화면에 앱처럼 설치(PWA)

**아직 안 됩니다 (다음 단계 과제)**
- **기기 간 동기화**: 지금 저장 방식(localStorage)은 "이 브라우저"에만 저장돼요.
  다른 폰이나 브라우저로 열면 처음부터 다시 등록해야 하고, 여러 어르신 데이터를
  한 곳(관리자용 웹 CRM)에서 모아보는 것도 안 돼요. 이걸 하려면 진짜 데이터베이스
  (예: Supabase, Firebase)를 연결해야 합니다.
- **여러 사용자의 피드백을 한곳에 모으기**: 마찬가지로 localStorage 기반이라
  각자 기기에만 남아요. 서버 DB가 붙으면 해결됩니다.
- **로그인/계정 시스템**: 지금은 "가입 없이 정보 입력 → 바로 시작"이라 계정 개념이
  없어요. 보호자(자녀)가 별도로 로그인해서 보는 진짜 가족 리포트도 이 단계에서 필요.

## QA 자동 테스트

`qa/` 폴더에 어르신 페르소나로 대화를 시뮬레이션하고 사업계획서 기준으로 자동 채점하는
스크립트가 있습니다. 자세한 내용은 [qa/README.md](qa/README.md) 참고.

## 문제가 생기면

- 대화에 응답이 없다면: Vercel 프로젝트의 **Settings → Environment Variables**에
  `GEMINI_API_KEY`가 정확히 들어갔는지 확인하세요 (Claude로 전환한 상태라면
  `ANTHROPIC_API_KEY`와 결제 수단/크레딧이 Anthropic 콘솔에 등록되어 있는지 확인).
  Gemini 무료 티어 한도를 초과했을 수도 있습니다 — 이 경우 시간이 지나면 풀리거나,
  `AI_PROVIDER=anthropic`으로 수동 전환하세요.
- 배포 후 코드를 수정하고 싶으면: GitHub 저장소에서 파일을 다시 업로드(또는 수정)하면
  Vercel이 자동으로 재배포합니다.
