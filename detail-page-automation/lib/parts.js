'use strict';
const { icon } = require('./icons');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON 안의 줄바꿈(\n)을 그대로 디자인에 반영한다. */
const br = (s) => esc(s).replace(/\n/g, '<br>');

const shot = (src, ratio = 'r-1x1', cls = '') =>
  `<div class="shot ${ratio} ${cls}"><img src="${esc(src)}" alt=""></div>`;

/** 이미지 + 아래 캡션 (디테일 페이지의 포인트 카드) */
const figure = (src, ratio, title, desc) => `
  <div class="figure">
    ${shot(src, ratio)}
    <div class="cap-t">${br(title)}</div>
    <div class="cap-d">${br(desc)}</div>
  </div>`;

const badge = (brand, sm = false) => `
  <div class="badge ${sm ? 'badge--sm' : ''}">
    <div class="b-ko">${esc(brand.ko)}</div>
    <div class="b-en">${esc(brand.en)}</div>
  </div>`;

/** 원형 테두리 아이콘 + 아래 라벨 */
const iconItem = (name, label) => `
  <div class="icon-item">
    <div class="ico">${icon(name)}</div>
    <div class="icon-item__l">${br(label)}</div>
  </div>`;

const stars = (n = 5) =>
  `<div class="stars">${Array.from({ length: n }, () => icon('star')).join('')}</div>`;

const iconItemCss = `
.icon-item{text-align:center}
.icon-item__l{font-size:12px;font-weight:500;color:var(--ink-2);margin-top:12px;
  letter-spacing:-.03em;line-height:1.5;word-break:keep-all}
.ico{color:var(--green-soft)}
.stars{display:flex;gap:3px;justify-content:center;color:var(--green)}
.stars svg{width:11px;height:11px;display:block}
`;

module.exports = { esc, br, shot, figure, badge, iconItem, stars, iconItemCss, icon };
