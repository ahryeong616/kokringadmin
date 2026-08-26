'use strict';
const { esc, br, badge } = require('../lib/parts');

module.exports = {
  id: 1,
  key: 'cover',
  name: '커버',
  description: '대형 제품컷을 전면에 깔고 세리프 영문 타이틀을 얹는 표지.',

  css: `
.page{height:1560px;background:var(--cream-2)}
.bg{position:absolute;inset:0}
.bg img{width:100%;height:100%;object-fit:cover}
/* 사진이 밝아도 글씨가 살도록 왼쪽 위에만 옅은 막을 덮는다 */
.scrim{position:absolute;inset:0;
  background:linear-gradient(104deg,rgba(252,250,246,.95) 0%,rgba(252,250,246,.86) 34%,
    rgba(252,250,246,.42) 52%,rgba(252,250,246,0) 66%)}
.copy{position:absolute;left:74px;top:92px;right:300px;z-index:2}
.copy .ko{font-family:'NanumMyeongjo',serif;font-weight:700;font-size:31px;
  letter-spacing:-.02em;color:var(--ink);margin-bottom:12px}
.copy .en{font-family:'PlayfairDisplay',serif;font-weight:400;font-size:53px;
  line-height:1.14;letter-spacing:-.015em;color:var(--ink)}
.copy .rule{width:44px;height:1.5px;background:var(--ink-4);margin:34px 0 26px}
.copy .tag-en{font-size:16px;font-weight:600;color:var(--teal);letter-spacing:-.01em}
.copy .tag-ko{font-size:13.5px;font-weight:400;color:var(--ink-3);margin-top:20px}
.mark{position:absolute;left:74px;top:0;z-index:2}
`,

  render({ p, img }) {
    const c = p.cover;
    return `
<div class="page">
  <div class="bg"><img src="${esc(img.pick('hero', 0))}" alt="${esc(c.ko)}"></div>
  <div class="scrim"></div>
  <div class="mark" style="top:74px">${badge(p.brand)}</div>
  <div class="copy" style="top:196px">
    <div class="ko">${esc(c.ko)}</div>
    <div class="en">${c.en.map(esc).join('<br>')}</div>
    <div class="rule"></div>
    <div class="tag-en">${esc(c.tagEn)}</div>
    <div class="tag-ko">${esc(c.tagKo)}</div>
  </div>
</div>`;
  },
};
