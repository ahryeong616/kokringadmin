'use strict';
const { frame, grid, specTable, noticeList, noticeCss, esc } = require('../lib/parts');

module.exports = {
  id: 4,
  key: 'catalog',
  name: '카탈로그 그리드형',
  description: '큰 정사각 그리드와 컬러웨이를 앞세운 형식. 색상 옵션이 많은 상품을 한눈에 보여줄 때 적합.',

  css: `
${noticeCss}
.bar{display:flex;align-items:flex-end;justify-content:space-between;padding:44px 44px 24px}
.bar__l .brand{font-size:10px;font-weight:600;letter-spacing:.3em;color:var(--muted);margin-bottom:12px}
.bar__r{text-align:right;padding-bottom:4px}
.bar__r .caption{line-height:1.7}
.topline{height:1px;background:var(--ink);margin:0 44px 20px}

.mosaic{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mosaic .frame{aspect-ratio:1/1}

.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px 0}
.card{background:var(--soft-2);padding:26px 22px}
.card .n{font-size:11px;font-weight:700;letter-spacing:.16em;color:#c4c4cc}
.card .t{font-size:14px;font-weight:700;letter-spacing:-.03em;margin:10px 0 8px;line-height:1.4;word-break:keep-all}
.card .d{font-size:11.5px;line-height:1.85;color:var(--ink-3);letter-spacing:-.02em;word-break:keep-all}

.ways{padding:48px 44px 44px}
.ways__head{margin-bottom:24px}
.ways__list{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.way .sw{height:86px;border-radius:6px;border:1px solid rgba(0,0,0,.07)}
.way .ko{font-size:11px;font-weight:600;color:var(--ink-2);margin-top:11px;letter-spacing:-.02em;word-break:keep-all}
.way .en{font-size:9.5px;color:var(--muted);margin-top:2px}

.specband{padding:44px 44px 46px;display:grid;grid-template-columns:1fr 1fr;column-gap:48px}
.specband__head{grid-column:1 / -1;margin-bottom:18px}
.specband .spec th{width:70px}
.strip{padding:0 0 8px}
.foot{padding:34px 44px 46px}
.foot .rule{margin-bottom:20px}
`,

  render({ p, img }) {
    const half = Math.ceil(p.specs.length / 2);
    const cards = (p.features || []).slice(0, 3).map((f, i) => `
      <div class="card">
        <div class="n">0${i + 1}</div>
        <div class="t">${esc(f.title)}</div>
        <div class="d">${esc(f.desc)}</div>
      </div>`).join('');

    const ways = p.colors.map((c) => `
      <div class="way">
        <div class="sw" style="background:${esc(c.hex)}"></div>
        <div class="ko">${esc(c.ko)}</div>
        <div class="en">${esc(c.en)}</div>
      </div>`).join('');

    return `
<div class="page">
  <div class="bloom bloom--tr"></div>
  <section class="bar">
    <div class="bar__l">
      <div class="brand">${esc(p.brand)}</div>
      <div class="title-en">${esc(p.name.en)}</div>
      <div class="title-ko">${esc(p.name.ko)}</div>
    </div>
    <div class="bar__r"><div class="caption">${esc(p.tagline)}</div></div>
  </section>
  <div class="topline"></div>

  <section class="mosaic">
    ${frame(img.pick('hero', 0))}
    ${frame(img.pick('angle', 0))}
    ${frame(img.pick('angle', 1))}
    ${frame(img.pick('closeup', 0))}
  </section>

  <section class="cards">${cards}</section>

  <section class="ways">
    <div class="ways__head">
      <div class="section-label">Colorway</div>
      <div class="section-title">${p.colors.length}가지 컬러로 만나보세요</div>
    </div>
    <div class="ways__list">${ways}</div>
  </section>

  <section class="strip">${grid(img.take('lifestyle', 2), 2, 'r-3x2')}</section>

  <section class="specband">
    <div class="specband__head">
      <div class="section-label">Specification</div>
      <div class="section-title">제품 상세 정보</div>
    </div>
    <div>${specTable(p.specs.slice(0, half))}</div>
    <div>${specTable(p.specs.slice(half))}</div>
    <div class="bloom bloom--bl"></div>
  </section>

  <section class="foot"><hr class="rule">${noticeList(p.notice)}</section>
</div>`;
  },
};
