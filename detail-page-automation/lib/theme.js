'use strict';
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

// [파일명, CSS family, weight]
const FONTS = [
  ['Pretendard-Light.woff2',      'Pretendard',      300],
  ['Pretendard-Regular.woff2',    'Pretendard',      400],
  ['Pretendard-Medium.woff2',     'Pretendard',      500],
  ['Pretendard-SemiBold.woff2',   'Pretendard',      600],
  ['Pretendard-Bold.woff2',       'Pretendard',      700],
  ['NanumMyeongjo-400.woff2',     'NanumMyeongjo',   400],
  ['NanumMyeongjo-700.woff2',     'NanumMyeongjo',   700],
  ['NanumMyeongjo-800.woff2',     'NanumMyeongjo',   800],
  ['PlayfairDisplay-400.woff2',   'PlayfairDisplay', 400],
  ['PlayfairDisplay-600.woff2',   'PlayfairDisplay', 600],
  ['PlayfairDisplay-700.woff2',   'PlayfairDisplay', 700],
];

let _fontCss = null;
/**
 * 폰트를 data URI 로 HTML 안에 심는다.
 * file:// 로 참조하면 Chromium 의 CORS 정책에 막혀 폰트가 로드되지 않으므로
 * 임베딩이 환경에 상관없이 동일한 결과를 내는 유일한 방법이다.
 */
function fontFaceCss() {
  if (_fontCss) return _fontCss;
  const faces = [];
  for (const [file, family, weight] of FONTS) {
    const full = path.join(FONT_DIR, file);
    if (!fs.existsSync(full)) continue;
    const b64 = fs.readFileSync(full).toString('base64');
    faces.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
      `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
    );
  }
  if (!faces.length) throw new Error(`폰트 파일이 없습니다: ${FONT_DIR}`);
  _fontCss = faces.join('\n');
  return _fontCss;
}

/** 다섯 장이 한 세트로 보이도록 모든 템플릿이 공유하는 토큰과 조판 */
const baseCss = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
:root{
  --page: 860px;

  /* 크림 계열 배경 */
  --cream:   #F7F3EC;
  --cream-2: #FBF9F5;
  --cream-3: #F1ECE2;
  --white:   #FFFFFF;

  /* 먹색 계열 */
  --ink:   #2B2723;
  --ink-2: #55504A;
  --ink-3: #857D74;
  --ink-4: #A9A199;

  /* 브랜드 그린 */
  --green:      #4A7C59;
  --green-deep: #3B6647;
  --green-soft: #8FB894;
  --green-pale: #DCE7DC;
  --teal:       #1C6E7C;

  --line: #E5DFD4;
  --r-sm: 10px;
  --r:    16px;
  --r-lg: 22px;
}
body{
  width: var(--page);
  background: var(--cream-2);
  color: var(--ink);
  font-family:'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.02em;
}
img{display:block;width:100%;height:100%;object-fit:cover}
.page{width:var(--page);position:relative;overflow:hidden}

/* ---- 타이포 ---- */
.eyebrow{
  font-family:'Pretendard',sans-serif;font-size:11px;font-weight:500;
  letter-spacing:.34em;text-transform:uppercase;color:var(--ink-3);
}
.display{
  font-family:'NanumMyeongjo',serif;font-weight:800;
  font-size:38px;line-height:1.42;letter-spacing:-.02em;color:var(--ink);
}
.display--sm{font-size:30px;line-height:1.45}
.display--lg{font-size:44px;line-height:1.38}
.serif-en{
  font-family:'PlayfairDisplay',serif;font-weight:400;
  font-size:52px;line-height:1.12;letter-spacing:-.01em;color:var(--ink);
}
.body{font-size:13px;line-height:1.95;color:var(--ink-2);font-weight:400}
.body--sm{font-size:12px;line-height:1.85;color:var(--ink-3)}
.label-en{font-size:11px;font-weight:500;letter-spacing:.24em;color:var(--ink-3)}

/* 헤드라인 아래 짧은 구분선 */
.tick{width:26px;height:1.5px;background:var(--green-soft);margin:18px auto 0}
.tick--l{margin-left:0;margin-right:auto}
.tick--dark{background:var(--ink-4);width:22px}
.tick--v{width:1.5px;height:26px;background:var(--ink-4);margin:20px auto 0}

/* ---- 카드 / 이미지 ---- */
.card{background:var(--cream-3);border-radius:var(--r);overflow:hidden}
.shot{border-radius:var(--r);overflow:hidden;background:var(--cream-3);position:relative}
.shot--lg{border-radius:var(--r-lg)}
.r-1x1{aspect-ratio:1/1}
.r-4x5{aspect-ratio:4/5}
.r-3x4{aspect-ratio:3/4}
.r-4x3{aspect-ratio:4/3}
.r-3x2{aspect-ratio:3/2}
.r-16x9{aspect-ratio:16/9}
.r-2x1{aspect-ratio:2/1}

.grid{display:grid;gap:14px}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.g5{grid-template-columns:repeat(5,1fr)}

/* 캡션이 붙는 이미지 */
.figure .cap-t{font-size:14px;font-weight:700;color:var(--ink);margin-top:14px;letter-spacing:-.03em}
.figure .cap-d{font-size:11.5px;font-weight:400;color:var(--ink-3);margin-top:6px;line-height:1.6;word-break:keep-all}

/* 브랜드 로고 배지 */
.badge{width:56px;height:56px;border-radius:50%;background:var(--green);
  display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff}
.badge .b-ko{font-size:12px;font-weight:700;letter-spacing:-.03em;line-height:1}
.badge .b-en{font-size:5.5px;font-weight:600;letter-spacing:.12em;margin-top:2px;opacity:.9}
.badge--sm{width:30px;height:30px}
.badge--sm .b-ko{font-size:8px}
.badge--sm .b-en{display:none}

/* 아이콘 원형 테두리 */
.ico{width:52px;height:52px;border-radius:50%;border:1px solid var(--green-pale);
  display:flex;align-items:center;justify-content:center;margin:0 auto}
.ico svg{width:24px;height:24px;display:block}
`;

function documentShell({ css, body, width = 860 }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>${fontFaceCss()}</style>
<style>${baseCss}</style>
<style>:root{--page:${width}px}${css || ''}</style>
</head><body>${body}</body></html>`;
}

module.exports = { fontFaceCss, baseCss, documentShell, FONT_DIR };
