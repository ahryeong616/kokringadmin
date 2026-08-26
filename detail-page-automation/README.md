# 상세페이지 대량 생산 자동화 시스템

상품 사진 폴더 + 스펙 JSON 하나를 넣으면 **서로 다른 5가지 형식의 상세페이지 이미지**를
한 번에 뽑아내는 도구입니다. 상품이 늘어나도 명령 한 줄이면 됩니다.

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
# 그레이돌 상세페이지 5장 생성
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
| `--format 3` | 3번 형식만 다시 생성 (`--format 1,4` 처럼 여러 개도 가능) |
| `--scale 3` | 해상도 배율. 기본 2배, 인쇄용은 3배 |
| `--keep-html` | 렌더링에 쓰인 HTML 도 함께 저장 (디자인 수정할 때 유용) |

---

## 3. 새 제품 추가하는 법

`products/` 아래에 폴더를 하나 만들면 끝입니다.

```
products/
└── 새제품이름/
    ├── product.json      ← 상품 정보
    └── images/           ← 상품 사진
```

### 사진 이름 규칙

파일명 앞에 역할을 적어두면 자동으로 알맞은 자리에 배치됩니다.

| 접두사 | 쓰이는 곳 | 권장 장수 |
|---|---|---|
| `hero_` | 대표 이미지 | 1장 |
| `angle_` | 각도별 컷 | 4장 |
| `closeup_` | 디테일 컷 | 2장 |
| `life_` | 연출·패키지 컷 | 2장 |

예: `hero_01.jpg`, `angle_front.jpg`, `closeup_knit.jpg`, `life_pouch.jpg`

접두사를 안 붙여도 **파일 이름 순서대로 자동 배분**되므로 그냥 넣어도 동작합니다.
사진이 모자라면 있는 사진을 돌려 씁니다.

### product.json 작성

`products/graydoll/product.json` 을 복사해서 내용만 바꾸는 게 가장 빠릅니다.

```json
{
  "slug": "제품폴더명",
  "brand": "KOKRING",
  "name": { "en": "영문 상품명", "ko": "한글 상품명" },
  "tagline": "한 줄 카피",
  "lead": "상품 소개 문단",
  "specs":    [ { "label": "소재", "ko": "한글 값", "en": "English value" } ],
  "features": [ { "title": "특징 제목", "desc": "특징 설명" } ],
  "colors":   [ { "ko": "크림 아이보리", "en": "Cream Ivory", "hex": "#F2EBDD" } ],
  "notice":   [ "구매 전 안내 문구" ]
}
```

- `specs` 는 몇 줄이든 상관없습니다 (2단 배치 형식은 자동으로 반씩 나눕니다).
- `features` 는 **3개**를 권장합니다. 3·4·5번 형식이 이 값을 씁니다.
- `colors` 의 `hex` 가 컬러칩 색으로 그대로 칠해집니다.

---

## 4. 5가지 형식

| # | 이름 | 특징 | 어울리는 상품 |
|---|---|---|---|
| 1 | 스펙 히어로형 | 좌측 대표컷 + 우측 스펙표, 각도컷 4분할 | 기본형. 대부분의 상품 |
| 2 | 풀블리드 히어로형 | 상단을 대형 이미지로 꽉 채우고 제목을 얹음 | 신제품·시즌 상품 |
| 3 | 매거진 지그재그형 | 이미지와 설명을 좌우 번갈아 배치 | 설명할 특징이 많은 상품 |
| 4 | 카탈로그 그리드형 | 큰 정사각 그리드 + 컬러웨이 강조 | 색상 옵션이 많은 상품 |
| 5 | 스토리텔링 세로형 | 넉넉한 여백에 카피와 이미지를 차례로 | 브랜드 톤을 강조할 때 |

## 5. 형식을 고치거나 추가하려면

`templates/` 안의 파일 하나가 형식 하나입니다.

- **고치기**: 해당 파일의 `css` 와 `render()` 를 수정 → `node generate.js graydoll --format 2`
- **추가하기**: `06-이름.js` 로 파일을 만들고 `id: 6` 지정 → 자동으로 목록에 잡혀 6번째 이미지가 생성됩니다

공통 디자인(색·글꼴·여백·컬러칩 등)은 `lib/theme.js` 의 `baseCss` 에서 한 번에 바꿉니다.

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
│   └── parts.js             스펙표·컬러칩 등 공통 조각
├── templates/               5가지 형식
├── products/<제품>/         제품별 정보와 사진
├── assets/fonts/            Pretendard (OFL 라이선스)
└── output/                  생성 결과
```

## 참고

- 글꼴은 **Pretendard** 를 이미지 안에 직접 심어 렌더링하므로, 폰트가 설치되지 않은 PC에서도
  결과물이 똑같이 나옵니다.
- `tools/make-placeholders.js` 는 사진이 준비되기 전에 레이아웃만 확인하는 임시 이미지 생성기입니다.
  실제 사진을 넣은 뒤에는 `products/<제품>/images` 안의 `.svg` 임시 파일을 지워주세요.
