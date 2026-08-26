'use strict';
const { frame, grid, specTable, colorChips, noticeList, noticeCss, esc } = require('../lib/parts');

module.exports = {
  id: 3,
  key: 'magazine',
  name: '매거진 지그재그형',
  description: '이미지와 설명을 좌우 번갈아 배치해 읽는 흐름을 만드는 형식. 설명할 특징이 많은 상품에 적합.',

  css: `
${noticeCss}
.head{padding:64px 48px 44px;text-align:center}
.head .brand{font-size:10px;font-weight:600;letter-spacing:.3em;color:var(--muted);margin-bottom:16px}
.head .lead{margin:18px auto 0;max-width:520px}

.zig{display:grid;grid-template-columns:1fr 1fr;align-items:center}
.zig + .zig{margin-top:8px}
.zig--flip .zig__text{order:-1}
.zig__img{position:relative;overflow:hidden;background:var(--soft);height:340px}
.zig__img img{position:absolute;inset:0}
.zig__text{padding:0 46px}
.zig__num{font-size:11px;font-weight:700;letter-spacing:.18em;color:#c4c4cc}
.zig__title{font-size:18px;font-weight:700;letter-spacing:-.03em;margin:12px 0 10px;line-height:1.4}
.zig__desc{font-size:12.5px;line-height:1.9;color:var(--ink-3);letter-spacing:-.02em;word-break:keep-all}

.pair{padding:8px 0}
.specwrap{padding:50px 48px 46px}
.specwrap__head{margin-bottom:20px}
.specwrap .spec th{width:78px}
.colorrow{display:flex;align-items:flex-start;justify-content:space-between;gap:40px;
  padding:0 48px 46px}
.colorrow__l{flex:0 0 190px}
.foot{padding:0 48px 48px}
.foot .rule{margin-bottom:20px}
`,

  render({ p, img }) {
    const feats = (p.features || []).slice(0, 3);
    const rows = feats.map((f, i) => `
      <section class="zig ${i % 2 ? 'zig--flip' : ''}">
        <div class="zig__img"><img src="${esc(img.pick(i === 0 ? 'closeup' : 'angle', i))}" alt=""></div>
        <div class="zig__text">
          <div class="zig__num">0${i + 1}</div>
          <div class="zig__title">${esc(f.title)}</div>
          <p class="zig__desc">${esc(f.desc)}</p>
        </div>
      </section>`).join('');

    return `
<div class="page">
  <section class="head">
    <div class="bloom bloom--tr"></div>
    <div class="brand">${esc(p.brand)}</div>
    <div class="title-en">${esc(p.name.en)}</div>
    <div class="title-ko">${esc(p.name.ko)}</div>
    <p class="lead">${esc(p.lead)}</p>
  </section>

  <section class="pair">${frame(img.pick('hero', 0), 'r-3x2')}</section>

  ${rows}

  <section class="pair">${grid(img.take('lifestyle', 2), 2, 'r-4x3')}</section>

  <section class="specwrap">
    <div class="specwrap__head">
      <div class="section-label">Specification</div>
      <div class="section-title">제품 상세 정보</div>
    </div>
    ${specTable(p.specs)}
  </section>

  <section class="colorrow">
    <div class="colorrow__l">
      <div class="section-label">Colorway</div>
      <div class="section-title">컬러 선택</div>
    </div>
    ${colorChips(p.colors)}
    <div class="bloom bloom--bl"></div>
  </section>

  <section class="foot"><hr class="rule">${noticeList(p.notice)}</section>
</div>`;
  },
};
