'use strict';
const { esc, br, shot, figure } = require('../lib/parts');

module.exports = {
  id: 3,
  key: 'detail',
  name: '제품 디테일',
  description: 'FRONT·SIDE 로 형태를 보여주고, 클로즈업마다 캡션을 달아 만듦새를 설명한다.',

  css: `
.page{background:var(--cream-2)}
.head{padding:64px 60px 0;text-align:center}
.head .display{font-size:37px;font-weight:800;margin-top:22px}

.front{display:grid;grid-template-columns:1fr 1.42fr;gap:20px;align-items:center;
  padding:46px 60px 8px}
.front__t{padding-left:34px}
.front__i{position:relative;height:400px}
.front__i img{position:absolute;inset:0;object-fit:contain}
.blk-label{font-size:11px;font-weight:500;letter-spacing:.26em;color:var(--ink-3)}
.blk-rule{width:18px;height:1.5px;background:var(--ink-4);margin:12px 0 16px}
.blk-desc{font-size:12.5px;line-height:2.05;color:var(--ink-2);word-break:keep-all}

.side{margin:18px 26px 0;background:var(--cream-3);border-radius:var(--r-lg);
  display:grid;grid-template-columns:0.72fr 1fr 1fr;align-items:center;
  padding:34px 34px 34px 40px;gap:12px}
.side__i{position:relative;height:290px}
.side__i img{position:absolute;inset:0;object-fit:contain}

.points{padding:34px 26px 64px;display:flex;flex-direction:column;gap:30px}
.prow{display:grid;gap:22px}
.prow--2{grid-template-columns:1fr 1fr}
.prow--1{grid-template-columns:1fr}
`,

  render({ p, img }) {
    const d = p.detail;

    // wide 플래그에 따라 2단 행과 전폭 행을 섞어 쌓는다.
    const rows = [];
    let pair = [];
    let n = 0;
    const flushPair = () => {
      if (!pair.length) return;
      rows.push(`<div class="prow prow--${pair.length}">${pair.join('')}</div>`);
      pair = [];
    };
    for (const pt of d.points) {
      const fig = figure(img.pick('closeup', n++), pt.wide ? 'r-2x1' : 'r-4x3', pt.title, pt.desc);
      if (pt.wide) { flushPair(); rows.push(`<div class="prow prow--1">${fig}</div>`); }
      else { pair.push(fig); if (pair.length === 2) flushPair(); }
    }
    flushPair();

    return `
<div class="page">
  <section class="head">
    <div class="eyebrow">${esc(d.eyebrow)}</div>
    <div class="display">${br(d.headline)}</div>
  </section>

  <section class="front">
    <div class="front__t">
      <div class="blk-label">${esc(d.front.label)}</div>
      <div class="blk-rule"></div>
      <div class="blk-desc">${br(d.front.desc)}</div>
    </div>
    <div class="front__i"><img src="${esc(img.pick('front', 0))}" alt=""></div>
  </section>

  <section class="side">
    <div>
      <div class="blk-label">${esc(d.side.label)}</div>
      <div class="blk-rule"></div>
      <div class="blk-desc">${br(d.side.desc)}</div>
    </div>
    <div class="side__i"><img src="${esc(img.pick('side', 0))}" alt=""></div>
    <div class="side__i"><img src="${esc(img.pick('side', 1))}" alt=""></div>
  </section>

  <section class="points">${rows.join('')}</section>
</div>`;
  },
};
