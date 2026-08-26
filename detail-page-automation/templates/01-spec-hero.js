'use strict';
const { frame, grid, specTable, colorChips, titleBlock, noticeList, noticeCss, esc } = require('../lib/parts');

module.exports = {
  id: 1,
  key: 'spec-hero',
  name: '스펙 히어로형',
  description: '좌측 대표 이미지 + 우측 스펙표. 각도컷 4분할, 디테일 2분할, 연출컷과 컬러웨이로 마무리하는 기본형.',

  css: `
${noticeCss}
.hero{display:grid;grid-template-columns:1.02fr 1fr;position:relative;z-index:1}
.hero__img{position:relative;overflow:hidden;background:var(--soft)}
.hero__img img{position:absolute;inset:0}
.hero__panel{padding:56px 46px 46px 44px;display:flex;flex-direction:column;min-height:560px}
.hero__panel .brand{font-size:10px;font-weight:600;letter-spacing:.28em;color:var(--muted);margin-bottom:18px}
.hero__lead{font-size:12px;line-height:1.8;color:var(--ink-3);margin:16px 0 26px;letter-spacing:-.02em}
.band{padding:0}
.closeups{padding:8px 0}
.bottom{display:grid;grid-template-columns:1.22fr 0.92fr 1.18fr;gap:8px;align-items:stretch}
/* 칼럼 폭이 서로 달라 비율만으로는 높이가 어긋나므로 행 높이를 고정한다 */
.bottom .frame{aspect-ratio:auto;height:236px}
.bottom__colors{padding:18px 4px 0 20px}
.bottom__colors .section-label{margin-bottom:16px}
.foot{padding:34px 44px 46px;position:relative;z-index:1}
.foot .rule{margin-bottom:20px}
`,

  render({ p, img }) {
    return `
<div class="page">
  <div class="bloom bloom--tr"></div>

  <section class="hero">
    <div class="hero__img"><img src="${esc(img.pick('hero', 0))}" alt="${esc(p.name.ko)}"></div>
    <div class="hero__panel">
      <div class="brand">${esc(p.brand)}</div>
      ${titleBlock(p)}
      <p class="hero__lead">${esc(p.tagline)}</p>
      ${specTable(p.specs)}
    </div>
  </section>

  <section class="band">${grid(img.take('angle', 4), 4, 'r-3x4')}</section>
  <section class="closeups">${grid(img.take('closeup', 2), 2, 'r-4x3')}</section>

  <section class="bottom">
    ${frame(img.pick('lifestyle', 0), 'r-4x3')}
    ${frame(img.pick('lifestyle', 1), 'r-4x3')}
    <div class="bottom__colors">
      <div class="section-label">Colorway</div>
      ${colorChips(p.colors)}
    </div>
  </section>

  <section class="foot">
    <hr class="rule">
    ${noticeList(p.notice)}
  </section>
  <div class="bloom bloom--bl"></div>
</div>`;
  },
};
