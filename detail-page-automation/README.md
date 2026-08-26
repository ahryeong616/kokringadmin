# 상세페이지 대량 생산 자동화 시스템

상품 사진 폴더 + 콘텐츠 JSON 하나를 넣으면 **상세페이지 5장을 한 세트로** 뽑아내는 도구입니다.
상품이 늘어나도 명령 한 줄이면 됩니다.

```
사진 폴더 + product.json  →  5개 템플릿 렌더링  →  제품명_1.png ~ 제품명_5.png
```

---

## 1. 설치 (최초 1회)

PC에 [Node.js](https://nodejs.org) LTS 버전이 필요합니다.

```bash
cd detail-page-automation
npm install
npx playwright install chromium
```

## 2. 실행

```bash
# 상세페이지 5장 생성
node generate.js graydoll

# products/ 안의 모든 제품을 한 번에 (대량 생산)
node generate.js --all
```

결과는 `output/제품명/제품명_1.png` ~ `_5.png` 로 저장됩니다.

### 원하는 폴더에 바로 저장하기

```bash
node generate.js graydoll --out "D:/kokringadmin-main/kokring_shangpei"
```
→ `D:\kokringadmin-main\kokring_shangpei\graydoll\graydoll_1.png` ~ `_5.png`

### 사진 폴더를 따로 지정하기

제품 폴더로 사진을 옮기지 않고 원본 폴더를 그대로 쓸 수 있습니다.

```bash
node generate.js graydoll --images "D:/kokringadmin-main/kokring_shangpei/Grip+doll"
```

### 그 밖의 옵션

| 옵션 | 설명 |
|---|---|
| `--format 3` | 3번 페이지만 다시 생성 (`--format 1,4` 처럼 여러 개도 가능) |
| `--scale 3` | 해상도 배율. 기본 2배, 인쇄용은 3배 |
| `--keep-html` | 렌더링에 쓰인 HTML 도 함께 저장 (디자인 수정할 때 유용) |

---

## 3. 5장의 구성

한 상품의 상세페이지를 다섯 장으로 나눈 것이며, **위에서 아래로 이어지는 순서**입니다.

| # | 페이지 | 담는 내용 |
|---|---|---|
| 1 | 커버 | 대형 제품컷 위에 세리프 영문 타이틀. 첫인상 |
| 2 | 문제 제기 | "이런 경험 있으신가요?" 상황 3가지 + 브랜드 이야기 |
| 3 | 제품 디테일 | FRONT · SIDE 형태 소개 + 클로즈업마다 캡션 |
| 4 | 라이프스타일 | 사용 장면을 크게 쌓고, 선택할 이유 4가지 |
| 5 | 선물 · 후기 · FAQ | 추천 대상 5 + 후기 3 + FAQ + 구매 버튼 |

---

## 4. 새 제품 추가하는 법

`products/` 아래에 폴더를 하나 만들면 끝입니다.

```
products/
└── 새제품이름/
    ├── product.json      ← 페이지에 들어갈 모든 글
    └── images/           ← 상품 사진
```

### 사진 이름 규칙

파일명 앞에 역할을 적어두면 자동으로 알맞은 자리에 배치됩니다.

| 접두사 | 쓰이는 곳 | 권장 장수 |
|---|---|---|
| `hero_` | 1번 커버, 5번 상단 | 1장 |
| `front_` | 3번 FRONT | 1장 |
| `side_` | 3번 SIDE | 2장 |
| `closeup_` | 3번 디테일 캡션 카드 | 5장 |
| `life_` | 4번 사용 장면, 5번 CTA | 4장 |
| `people_` | 5번 추천 대상 | 2장 |

예: `hero_01.jpg`, `front_01.jpg`, `side_01.jpg`, `closeup_band.jpg`, `life_bag.jpg`

접두사를 안 붙여도 **파일 이름 순서대로 자동 배분**되므로 그냥 넣어도 동작합니다.
사진이 모자라면 있는 사진을 돌려 씁니다.

### product.json 작성

`products/graydoll/product.json` 을 복사해서 글만 바꾸는 게 가장 빠릅니다.
글 안에서 `\n` 을 쓰면 그 자리에서 줄이 바뀝니다 (헤드라인 줄바꿈을 직접 잡을 때 사용).

```json
{
  "slug": "제품폴더명",
  "brand": { "ko": "콕링", "en": "COOKRING" },

  "cover":   { "ko": "콕링", "en": ["Shuttlecock", "Grip Cover"],
               "tagEn": "영문 태그라인", "tagKo": "한글 태그라인" },

  "problem": { "headline": "이런 경험, 있으신가요?",
               "items": [ { "no": "01", "icon": "rackets", "title": "두 줄로\n쓰는 제목" } ],
               "story": { "headline": "브랜드\n한마디", "body": "이야기 본문" } },

  "detail":  { "eyebrow": "PRODUCT DETAIL", "headline": "헤드라인",
               "front": { "label": "FRONT", "desc": "설명" },
               "side":  { "label": "SIDE",  "desc": "설명" },
               "points": [ { "wide": false, "title": "포인트 제목", "desc": "포인트 설명" } ] },

  "lifestyle": { "headline": "헤드라인", "reasonsTitle": "선택하는 이유",
                 "reasons": [ { "icon": "racket", "label": "라켓 식별" } ] },

  "gift":    { "eyebrow": "윗줄", "headline": "헤드라인", "sub": "보조 설명",
               "recipients": [ { "icon": "woman", "label": "여자친구" } ],
               "reviewsTitle": "후기 제목",
               "reviews": [ { "quote": "후기\n내용", "stars": 5 } ],
               "faqTitle": "자주 묻는 질문",
               "faq": [ { "q": "질문", "a": "답변" } ],
               "cta": { "headline": "마무리\n헤드라인", "body": "본문", "button": "지금 구매하기" } }
}
```

- `points` 의 `"wide": true` 는 그 이미지를 **전폭 한 줄**로 배치합니다. `false` 는 2단 배치.
- `recipients` 는 5개, `reasons` 는 4개일 때 칸이 정확히 맞습니다.
- `faq` 와 `reviews` 는 개수 제한이 없습니다.

### 쓸 수 있는 아이콘 이름

```
racket  rackets  gift  smile  shield  heart
woman   man      group shoe   book
```

---

## 5. 디자인을 고치거나 페이지를 추가하려면

`templates/` 안의 파일 하나가 페이지 하나입니다.

- **고치기**: 해당 파일의 `css` 와 `render()` 를 수정 → `node generate.js graydoll --format 2`
- **추가하기**: `06-이름.js` 로 파일을 만들고 `id: 6` 지정 → 자동으로 6번째 페이지가 생성됩니다
- **순서 바꾸기**: 각 파일의 `id` 숫자를 바꾸면 그대로 파일명 번호가 됩니다

색·글꼴·여백·라운드 값 같은 **공통 디자인은 `lib/theme.js` 의 `baseCss`** 한 곳에서 바꿉니다.
크림 배경(`--cream`), 먹색(`--ink`), 브랜드 그린(`--green`) 이 모두 변수로 잡혀 있습니다.

---

## 폴더 구조

```
detail-page-automation/
├── generate.js              실행 진입점 (CLI)
├── lib/
│   ├── browser.js           Chromium 실행 (환경별 경로 자동 탐지)
│   ├── render.js            HTML → PNG 렌더링
│   ├── images.js            사진 폴더 스캔·역할 분류
│   ├── templates.js         템플릿 로더
│   ├── theme.js             공통 디자인 시스템 + 폰트 임베딩
│   ├── parts.js             카드·캡션·별점 등 공통 조각
│   └── icons.js             라인 아이콘 모음
├── templates/               5개 페이지
├── products/<제품>/         제품별 글과 사진
├── assets/fonts/            Pretendard · 나눔명조 · Playfair Display
└── output/                  생성 결과
```

## 참고

- 글꼴을 이미지 안에 직접 심어 렌더링하므로, 폰트가 설치되지 않은 PC에서도 결과물이 똑같이 나옵니다.
  헤드라인은 나눔명조, 영문 타이틀은 Playfair Display, 본문은 Pretendard 를 씁니다. 셋 다 OFL 라이선스입니다.
- `tools/make-placeholders.js` 는 사진이 준비되기 전에 레이아웃만 확인하는 임시 이미지 생성기입니다.
  실제 사진을 넣은 뒤에는 `products/<제품>/images` 안의 `.svg` 임시 파일을 지워주세요.
