'use strict';
const { frame, grid, specTable, colorChips, noticeList, noticeCss, esc } = require('../lib/parts');

module.exports = {
  id: 2,
  key: 'full-bleed',
  name: '풀블리드 히어로형',
  description: '상단을 대형 이미지로 꽉 채우고 제목을 얹는 형식. 첫인상이 강해 신제품·시즌 상품에 적합.',

  css: `
${noticeCss}
.hero{position:relative;height:520px;overflow:hidden}
.hero img{position:absolute;inset:0}
.hero__veil{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(12,12,14,.30) 0%,rgba(12,12,14,0) 34%,rgba(12,12,14,.62) 100%)}
.hero__copy{position:absolute;left:48px;right:48px;bottom:40px;color:#fff}
.hero__copy .brand{font-size:10px;font-weight:600;letter-spacing:.3em;opacity:.82;margin-bottom:14px}
.hero__copy .en{font-size:38px;font-weight:600;letter-spacing:-.025em;line-height:1.1}
.hero__copy .ko{font-size:20px;font-weight:600;letter-spacing:-.03em;margin-top:8px;opacity:.94}

.intro{padding:56px 130px 46px;text-align:center}
.intro .lead{font-size:13px;line-height:2}

.angles{padding:0 0 8px}
.spec-band{padding:46px 48px 44px;background:var(--soft-2)}
.spec-band__head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:22px}
.spec-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:52px}
.spec-cols .spec th{width:70px}

.wide{padding:8px 0}
.colorband{padding:44px 48px 40px;text-align:center}
.colorband .colors{justify-content:center;gap:14px 18px;margin-top:20px}
.foot{padding:8px 48px 46px}
.foot .rule{margin-bottom:20px}
`,

  render({ p, img }) {
    const half = Math.ceil(p.specs.length / 2);
    return `
<div class="page">
  <section class="hero">
    <img src="${esc(img.pick('hero', 0))}" alt="${esc(p.name.ko)}">
    <div class="hero__veil"></div>
    <div class="hero__copy">
      <div class="brand">${esc(p.brand)}</div>
      <div class="en">${esc(p.name.en)}</div>
      <div class="ko">${esc(p.name.ko)}</div>
    </div>
  </section>

  <section class="intro">
    <div class="bloom bloom--tr"></div>
    <div class="section-label">About</div>
    <p class="lead" style="margin-top:14px">${esc(p.lead)}</p>
  </section>

  <section class="angles">${grid(img.take('angle', 3), 3, 'r-3x4')}</section>

  <section class="spec-band">
    <div class="spec-band__head">
      <div>
        <div class="section-label">Specification</div>
        <div class="section-title">제품 상세 정보</div>
      </div>
      <div class="caption">${esc(p.name.en)}</div>
    </div>
    <div class="spec-cols">
      <div>${specTable(p.specs.slice(0, half))}</div>
      <div>${specTable(p.specs.slice(half))}</div>
    </div>
  </section>

  <section class="wide">${frame(img.pick('closeup', 0), 'r-16x9')}</section>
  <section class="wide">${grid(img.take('lifestyle', 2), 2, 'r-4x3')}</section>

  <section class="colorband">
    <div class="section-label">Colorway</div>
    <div class="section-title">5가지 컬러</div>
    ${colorChips(p.colors)}
    <div class="bloom bloom--bl"></div>
  </section>

  <section class="foot"><hr class="rule">${noticeList(p.notice)}</section>
</div>`;
  },
};
