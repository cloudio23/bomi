# 인스타그램 건강 카드뉴스 자동화 — 설정 가이드

매일 아침(08:00 KST) 건강 뉴스에서 주제를 골라 카드뉴스를 만들고, 텔레그램으로
미리보기를 보내드리면 승인 버튼 하나로 실제 인스타그램에 올라가는 파이프라인입니다.
전체 동작 방식은 `api/cardnews.js` 상단 주석, 디자인/카피 규칙은 `STYLE_GUIDE.md`
참고하세요. 이 문서는 "처음 한 번만 하면 되는 설정"만 다룹니다.

준비물 체크리스트: Instagram 계정(있음, 아직 비즈니스 전환 전) → 아래 1~5단계를
순서대로 따라가면 됩니다. 중간에 막히면 어느 단계였는지만 알려주세요.

---

## 1단계. Instagram 비즈니스 계정 전환 + Facebook 페이지 연결

1. 인스타그램 앱 → 프로필 → 메뉴(☰) → **설정 및 개인정보** → **계정 유형 및 도구**
   → **프로페셔널 계정으로 전환** → **크리에이터** 또는 **비즈니스** 선택(건강 정보
   콘텐츠니 "건강/웰빙" 카테고리 선택 가능).
2. 전환 과정에서 **Facebook 페이지 연결**을 요구합니다 — 없으면 그 자리에서 새로
   만들 수 있어요(개인 프로필과 별개인 "페이지"입니다). 이미 브랜드용 Facebook
   페이지가 있다면 그걸 연결하세요.
3. 완료되면 인스타그램 프로필에 "프로페셔널 계정"이 표시됩니다.

## 2단계. Meta 개발자 앱 만들고 액세스 토큰 발급받기

**참고**: 아래는 실제로 진행하면서 확인된 "Instagram API with Instagram Login"
방식 기준입니다(발급된 토큰이 `IGAA`로 시작 — Facebook 페이지를 경유하는 예전
방식보다 더 간단합니다).

1. https://developers.facebook.com 접속 → 로그인 → 우측 상단 **내 앱** →
   **앱 만들기** → 유형은 **비즈니스** 선택 → 이름 입력(예: `bomi-cardnews`) → 생성.
   (등록 과정에서 전화번호 인증을 요구하면, "Accounts Center"로 이동해서 번호를
   추가·인증한 뒤 돌아오면 됩니다.)
2. 앱 대시보드 왼쪽 메뉴 **이용 사례** → **Instagram 로그인이 포함된 API 설정**
   선택("해시태그/인사이트 추적용" 안내가 뜨는 "API setup with Facebook login"은
   무시해도 됩니다 — 우리는 콘텐츠 발행만 하면 되므로 필요 없음).
3. **권한 및 기능** 탭에서 아래 권한을 추가(토글 켜기):
   - `instagram_business_basic`
   - `instagram_business_content_publish` ← 카드뉴스 자동 게시에 실제로 필요한 핵심 권한
4. **앱 역할 → 역할** 메뉴에서 **Instagram 테스터**로 실제 게시할 Instagram 계정을
   추가 → 그 Instagram 계정으로 로그인해서 (Instagram 앱 설정 → 웹사이트 권한 →
   앱 및 웹사이트 → 테스터 초대) **초대 수락**까지 해야 다음 단계 로그인이 통과됩니다.
5. "Instagram 로그인이 포함된 API 설정" 화면 → **액세스 토큰 생성** 섹션에서
   Instagram 계정 연결(로그인 팝업 허용) → 토큰 발급. **이 토큰은 절대 채팅/메신저에
   붙여넣지 말고 바로 다음 단계에만 사용**하세요(붙여넣는 순간 유출로 간주하고
   재발급해야 합니다).
6. 이 토큰은 **단기 토큰(1시간)**입니다. **장기 토큰(60일)**으로 바꿔야 자동화가
   매일 안정적으로 돕니다 — 터미널에서 아래 실행(YOUR_APP_SECRET은 앱 대시보드 →
   앱 설정 → 기본 설정의 "앱 시크릿 코드", YOUR_SHORT_TOKEN은 5번에서 받은 토큰):
   ```
   curl "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=YOUR_APP_SECRET&access_token=YOUR_SHORT_TOKEN"
   ```
   응답의 `access_token`이 **`IG_ACCESS_TOKEN`**. **약 60일마다 만료**되니 만료 전에
   같은 방식으로 재발급해서 Vercel 환경변수를 갱신해야 해요(자동 갱신 로직은 이번
   범위에 넣지 않았습니다).
7. `IG_BUSINESS_ACCOUNT_ID`는 **따로 설정하지 않아도 됩니다** — `lib/instagramApi.mjs`가
   `IG_ACCESS_TOKEN`만으로 `graph.instagram.com/me`를 호출해서 자동으로 알아냅니다.
   (필요하면 `GET https://graph.instagram.com/me?fields=id,username&access_token=...`로
   직접 확인해서 `IG_BUSINESS_ACCOUNT_ID` 환경변수로 고정할 수도 있어요 — 선택사항.)

## 3단계. 텔레그램 봇 만들기 (검토/승인용)

1. 텔레그램에서 **@BotFather** 검색 → 대화 시작 → `/newbot` 입력 → 봇 이름과
   아이디(예: `bomi_cardnews_bot`) 설정 → 발급된 토큰이 `TELEGRAM_BOT_TOKEN`.
2. 만든 봇과 1:1로 대화를 아무거나 한 번 보내세요(예: "안녕"). 그다음 브라우저에서
   아래 접속(YOUR_TOKEN은 방금 받은 토큰):
   `https://api.telegram.org/botYOUR_TOKEN/getUpdates`
   응답에서 `"chat":{"id": 123456789, ...}`의 숫자가 `TELEGRAM_CHAT_ID`입니다.
3. `TELEGRAM_WEBHOOK_SECRET`은 아무 임의의 긴 문자열을 직접 만들어서 정하면
   됩니다(예: 32자 랜덤 문자열 — 승인 버튼을 아무나 못 누르게 막는 값이라 외부에
   노출되면 안 돼요).
4. **배포 이후에** 아래 명령으로 웹훅을 등록합니다(YOUR_TOKEN, YOUR_VERCEL_URL,
   YOUR_WEBHOOK_SECRET을 실제 값으로 바꿔서 터미널에서 실행):
   ```
   curl "https://api.telegram.org/botYOUR_TOKEN/setWebhook?url=https://YOUR_VERCEL_URL/api/cardnews?action=webhook&secret_token=YOUR_WEBHOOK_SECRET"
   ```
   성공하면 `{"ok":true,"result":true,...}`가 나옵니다.

## 4단계. OpenAI 이미지 생성 키 (카드뉴스 표지 사진용)

1. https://platform.openai.com/api-keys 접속 → 로그인 → **Create new secret key**
   → 발급된 키가 `OPENAI_API_KEY`. **Billing**에서 결제 수단 등록 필요(이미지
   생성은 Gemini 무료 티어와 달리 사용한 만큼 과금됩니다 — 대략 장당 몇 센트
   수준, 하루 표지 1장만 생성하도록 이미 설계해뒀어요).
2. 이 키가 없으면 자동으로 실패하는 게 아니라, **타이포그래피 전용 표지로
   자동 대체**됩니다(`lib/aiImageGen.mjs` 참고) — 나중에 키를 넣어도 됩니다.

## 5단계. Supabase 테이블 만들기

1. 보미 앱이 이미 쓰고 있는 Supabase 프로젝트(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가
   이미 Vercel에 등록돼 있을 거예요)의 대시보드 → **SQL Editor** → 새 쿼리 →
   `supabase/cardnews_schema.sql` 파일 내용 전체를 붙여넣고 **Run**.
2. 이미 등록된 `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 환경변수를 그대로
   재사용하므로 이 단계엔 새 환경변수가 없습니다.

## 6단계. Vercel 환경변수 등록 + 배포

Vercel 프로젝트 → **Settings → Environment Variables**에 아래를 추가:

| 키 | 값 | 필수 |
|---|---|---|
| `IG_ACCESS_TOKEN` | 2단계 장기 토큰 | 필수 |
| `IG_BUSINESS_ACCOUNT_ID` | 2단계 7번(선택) | 선택 (없으면 토큰으로 자동 조회) |
| `TELEGRAM_BOT_TOKEN` | 3단계 | 필수 |
| `TELEGRAM_CHAT_ID` | 3단계 | 필수 |
| `TELEGRAM_WEBHOOK_SECRET` | 3단계에서 직접 정한 값 | 필수 |
| `CRON_SECRET` | 직접 정한 임의의 긴 문자열 | 필수 (없으면 cron 액션이 항상 401로 막힘 — 의도된 안전장치) |
| `OPENAI_API_KEY` | 4단계 | 선택(없으면 표지 사진 없이 텍스트 전용으로 자동 대체) |

등록 후 재배포하면 `vercel.json`의 `crons` 설정(매일 23:00 UTC = 08:00 KST)이
자동으로 활성화됩니다. **Vercel Hobby(무료) 플랜은 Cron Job이 하루 1회로
제한**되니 지금 설정 그대로가 딱 맞습니다.

배포가 끝나면 3단계 4번의 `setWebhook` 명령을 실제 배포 주소로 실행해주세요
(배포 전엔 주소가 없어서 미리 할 수 없어요).

---

## 확인/테스트 방법

- **오늘 당장 한 번 돌려보기(수동 트리거)**: 아래 명령으로 cron 로직을 즉시
  실행할 수 있습니다(YOUR_VERCEL_URL, YOUR_CRON_SECRET을 실제 값으로):
  ```
  curl -X GET "https://YOUR_VERCEL_URL/api/cardnews?action=cron" -H "Authorization: Bearer YOUR_CRON_SECRET"
  ```
  성공하면 텔레그램으로 카드뉴스 미리보기 + 승인/거절 버튼이 옵니다.
- **디자인만 로컬에서 미리 보기(배포/계정 설정 전에도 가능)**:
  ```
  node scripts/render-to-output.mjs
  ```
  `output/오늘날짜/demo/` 폴더에 슬라이드 PNG가 저장됩니다(레포에는 커밋되지
  않도록 `.gitignore`에 이미 추가해뒀어요).
- **실제 초안을 로컬로 다운로드**: `node scripts/render-to-output.mjs --latest`

## 문제가 생기면

- 텔레그램에 미리보기가 안 온다: Vercel 함수 로그에서 `/api/cardnews?action=cron`
  응답을 확인하세요. `IG_...`/`TELEGRAM_...` 환경변수 오타가 가장 흔한 원인입니다.
- 승인 버튼을 눌렀는데 반응이 없다: `setWebhook`을 실제 배포 주소로 다시 실행했는지,
  `TELEGRAM_WEBHOOK_SECRET`이 Vercel 환경변수 값과 정확히 같은지 확인하세요.
- 업로드 실패 메시지가 온다: 대부분 `IG_ACCESS_TOKEN` 만료(약 60일)입니다. 2단계
  4번을 다시 진행해서 새 장기 토큰으로 교체하세요.
- 매일 같은 매체 기사만 나온다: `lib/healthNewsFeed.mjs`의 `FEEDS` 배열에 소스를
  더 추가할 수 있습니다(RSS 주소가 실제로 200을 반환하는지 먼저 `curl`로 확인해보고
  추가하세요 — 이번에 확인해보니 국내 매체 상당수가 RSS를 이미 없앴어요).
