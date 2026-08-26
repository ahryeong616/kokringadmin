'use strict';
/** 여러 템플릿이 공통으로 쓰는 조각들 */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const frame = (src, ratio = 'r-1x1', alt = '') =>
  `<div class="frame ${ratio}"><img src="${esc(src)}" alt="${esc(alt)}"></div>`;

const grid = (srcs, cols = 4, ratio = 'r-3x4') =>
  `<div class="grid g${cols}">${srcs.map((s) => frame(s, ratio)).join('')}</div>`;

const specTable = (specs) => `<table class="spec">${specs.map((s) => `
  <tr><th>${esc(s.label)}</th><td>
    <div class="ko">${esc(s.ko)}</div>
    ${s.en ? `<div class="en">${esc(s.en)}</div>` : ''}
  </td></tr>`).join('')}</table>`;

const colorChips = (colors) => `<div class="colors">${colors.map((c) => `
  <div class="color">
    <div class="chip" style="background:${esc(c.hex)}"></div>
    <div class="n-ko">${esc(c.ko)}</div>
    <div class="n-en">${esc(c.en)}</div>
  </div>`).join('')}</div>`;

const titleBlock = (p, align = 'left') => `
  <div class="title-en" style="text-align:${align}">${esc(p.name.en)}</div>
  <div class="title-ko" style="text-align:${align}">${esc(p.name.ko)}</div>`;

const noticeList = (notice = []) => !notice.length ? '' : `
  <ul class="notice">${notice.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;

const noticeCss = `
.notice{margin:0;padding:0;list-style:none}
.notice li{font-size:10.5px;line-height:1.9;color:var(--muted);padding-left:11px;position:relative}
.notice li::before{content:'';position:absolute;left:0;top:8.5px;width:3px;height:3px;border-radius:50%;background:#c9c9cf}
`;

module.exports = { esc, frame, grid, specTable, colorChips, titleBlock, noticeList, noticeCss };
