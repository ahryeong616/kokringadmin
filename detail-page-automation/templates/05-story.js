'use strict';
const { frame, specTable, colorChips, noticeList, noticeCss, esc } = require('../lib/parts');

module.exports = {
  id: 5,
  key: 'story',
  name: '스토리텔링 세로형',
  description: '넉넉한 여백에 카피와 이미지를 차례로 쌓는 형식. 브랜드 톤을 차분하게 전달할 때 적합.',

  css: `
${noticeCss}
.wrap{padding:0 110px}
.open{padding:78px 110px 52px;text-align:center}
.open .brand{font-size:10px;font-weight:600;letter-spacing:.32em;color:var(--muted);margin-bottom:20px}
.open .title-en{font-size:32px;font-weight:300;letter-spacing:-.01em}
.open .title-ko{font-size:19px;font-weight:600;margin-top:10px}
.open .tag{font-size:12px;color:var(--ink-3);margin-top:22px;line-height:1.9;letter-spacing:-.02em}

.hero{padding:0 110px}
.chapter{padding:60px 110px 0;text-align:center}
.chapter .no{font-size:10px;font-weight:700;letter-spacing:.3em;color:#c4c4cc}
.chapter .t{font-size:20px;font-weight:700;letter-spacing:-.035em;margin:14px 0 12px;line-height:1.45;word-break:keep-all}
.chapter .d{font-size:12.5px;line-height:2.05;color:var(--ink-3);letter-spacing:-.02em;
  max-width:440px;margin:0 auto;word-break:keep-all}
.chapter .shot{margin-top:30px}

.quote{padding:72px 110px;text-align:center}
.quote p{font-size:16px;font-weight:500;line-height:1.95;color:var(--ink);letter-spacing:-.035em;
  margin:0;word-break:keep-all}

.specsec{padding:60px 110px 0}
.specsec__head{text-align:center;margin-bottom:24px}
.specsec .spec th{width:74px}

.colorsec{padding:56px 110px 0;text-align:center}
.colorsec .colors{justify-content:center;gap:14px 16px;margin-top:22px}
.foot{padding:52px 110px 60px}
.foot .rule{margin-bottom:20px}
`,

  render({ p, img }) {
    const chapters = (p.features || []).slice(0, 3).map((f, i) => `
      <section class="chapter">
        <div class="no">CHAPTER 0${i + 1}</div>
        <div class="t">${esc(f.title)}</div>
        <p class="d">${esc(f.desc)}</p>
        <div class="shot">${frame(img.pick(i === 1 ? 'closeup' : 'angle', i), 'r-4x3')}</div>
      </section>`).join('');

    return `
<div class="page">
  <div class="bloom bloom--tr"></div>
  <section class="open">
    <div class="brand">${esc(p.brand)}</div>
    <div class="title-en">${esc(p.name.en)}</div>
    <div class="title-ko">${esc(p.name.ko)}</div>
    <p class="tag">${esc(p.tagline)}</p>
  </section>

  <section class="hero">${frame(img.pick('hero', 0), 'r-4x5')}</section>

  <section class="quote"><p>${esc(p.lead)}</p></section>

  ${chapters}

  <section class="chapter"><div class="shot">${frame(img.pick('lifestyle', 0), 'r-3x2')}</div></section>

  <section class="specsec">
    <div class="specsec__head">
      <div class="section-label">Specification</div>
      <div class="section-title">제품 상세 정보</div>
    </div>
    ${specTable(p.specs)}
  </section>

  <section class="colorsec">
    <div class="section-label">Colorway</div>
    <div class="section-title">컬러 선택</div>
    ${colorChips(p.colors)}
    <div class="bloom bloom--bl"></div>
  </section>

  <section class="foot"><hr class="rule">${noticeList(p.notice)}</section>
</div>`;
  },
};
