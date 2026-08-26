'use strict';
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const WEIGHTS = { Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };

let _fontCss = null;
/**
 * 폰트를 data URI 로 HTML 안에 심는다.
 * file:// 로 참조하면 Chromium 의 CORS 정책에 막혀 폰트가 로드되지 않으므로
 * 임베딩이 유일하게 환경에 상관없이 동작하는 방식이다.
 */
function fontFaceCss() {
  if (_fontCss) return _fontCss;
  const faces = [];
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const file = path.join(FONT_DIR, `Pretendard-${name}.woff2`);
    if (!fs.existsSync(file)) continue;
    const b64 = fs.readFileSync(file).toString('base64');
    faces.push(
      `@font-face{font-family:'Pretendard';font-style:normal;font-weight:${weight};` +
      `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
    );
  }
  if (faces.length === 0) {
    throw new Error(`폰트 파일이 없습니다: ${FONT_DIR} (assets/fonts 에 Pretendard woff2 를 넣어주세요)`);
  }
  _fontCss = faces.join('\n');
  return _fontCss;
}

/** 모든 템플릿이 공유하는 디자인 토큰과 기본 조판 */
const baseCss = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
:root{
  --page: 860px;
  --ink: #17171a;
  --ink-2: #3d3d43;
  --ink-3: #6b6b73;
  --muted: #9a9aa2;
  --line: #e9e9ec;
  --line-2: #f2f2f4;
  --bg: #ffffff;
  --soft: #f6f6f7;
  --soft-2: #fafafa;
  --gap: 8px;
}
body{
  width: var(--page);
  background: var(--bg);
  color: var(--ink);
  font-family:'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'tnum';
  letter-spacing: -0.01em;
}
img{display:block;width:100%;height:100%;object-fit:cover}
.page{width:var(--page);overflow:hidden;position:relative}
.page > section{position:relative;z-index:1}

/* 레퍼런스의 은은한 파스텔 번짐 */
.bloom{position:absolute;border-radius:50%;filter:blur(70px);opacity:.5;pointer-events:none;z-index:0}
.bloom--tr{top:-140px;right:-120px;width:420px;height:420px;
  background:radial-gradient(circle,#ffe1ec 0%,#e6e8ff 45%,transparent 70%)}
.bloom--bl{bottom:-160px;left:-140px;width:460px;height:460px;
  background:radial-gradient(circle,#dff3ff 0%,#f2e9ff 45%,transparent 70%)}
.bloom--c{top:38%;left:-180px;width:380px;height:380px;
  background:radial-gradient(circle,#fff2d9 0%,transparent 68%)}

/* 타이포 */
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.title-en{font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1.15;color:var(--ink)}
.title-ko{font-size:23px;font-weight:700;letter-spacing:-.03em;line-height:1.3;color:var(--ink);margin-top:6px}
.lead{font-size:13px;font-weight:400;line-height:1.85;color:var(--ink-3)}
.section-label{font-size:10px;font-weight:600;letter-spacing:.24em;color:var(--muted);text-transform:uppercase}
.section-title{font-size:19px;font-weight:700;letter-spacing:-.03em;color:var(--ink);margin-top:10px}
.caption{font-size:11px;font-weight:500;color:var(--muted);letter-spacing:0}

/* 스펙 표 */
.spec{width:100%;border-collapse:collapse}
.spec tr + tr td, .spec tr + tr th{border-top:1px solid var(--line-2)}
.spec th{
  width:74px;text-align:left;vertical-align:top;padding:13px 0;
  font-size:12.5px;font-weight:700;color:var(--ink);letter-spacing:-.02em;white-space:nowrap;
}
.spec td{padding:13px 0 13px 16px;vertical-align:top}
.spec .ko{font-size:12.5px;font-weight:500;color:var(--ink-2);line-height:1.6;letter-spacing:-.02em}
.spec .en{font-size:11px;font-weight:400;color:var(--muted);line-height:1.55;margin-top:2px}

/* 이미지 그리드 */
.grid{display:grid;gap:var(--gap)}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.frame{position:relative;overflow:hidden;background:var(--soft)}
.r-1x1{aspect-ratio:1/1}
.r-4x5{aspect-ratio:4/5}
.r-3x4{aspect-ratio:3/4}
.r-4x3{aspect-ratio:4/3}
.r-16x9{aspect-ratio:16/9}
.r-3x2{aspect-ratio:3/2}

/* 컬러 칩 */
.colors{display:flex;flex-wrap:wrap;gap:10px 9px}
.color{width:56px;text-align:center}
.color .chip{width:56px;height:40px;border-radius:5px;border:1px solid rgba(0,0,0,.07)}
.color .n-ko{font-size:9px;word-break:keep-all;font-weight:600;color:var(--ink-2);margin-top:7px;line-height:1.35;letter-spacing:-.02em}
.color .n-en{font-size:8.5px;font-weight:400;color:var(--muted);line-height:1.35}

.rule{height:1px;background:var(--line);border:0;margin:0}
`;

function documentShell({ css, body, width = 860 }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>${fontFaceCss()}</style>
<style>${baseCss}</style>
<style>:root{--page:${width}px}${css || ''}</style>
</head><body>${body}</body></html>`;
}

module.exports = { fontFaceCss, baseCss, documentShell, FONT_DIR };
