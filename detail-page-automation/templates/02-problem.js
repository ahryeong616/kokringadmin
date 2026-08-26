'use strict';
const { esc, br, shot, icon } = require('../lib/parts');

module.exports = {
  id: 2,
  key: 'problem',
  name: '문제 제기',
  description: '고객이 겪는 상황 3가지를 카드로 짚고, 브랜드 이야기로 마무리한다.',

  css: `
.page{background:var(--cream-2);padding-bottom:0}
.head{padding:76px 60px 0;text-align:center}
.head .display{font-size:34px;font-weight:800}

.cards{padding:52px 40px 0;display:flex;flex-direction:column;gap:18px}
.pcard{display:grid;grid-template-columns:1fr 1.28fr;background:var(--cream-3);
  border-radius:var(--r-lg);overflow:hidden;min-height:296px}
.pcard--flip .pcard__t{order:2}
.pcard--flip .pcard__i{order:1}
.pcard__t{padding:44px 40px;display:flex;flex-direction:column;justify-content:center}
.pcard__no{font-size:11.5px;font-weight:600;letter-spacing:.16em;color:var(--ink-4);margin-bottom:14px}
.pcard__h{font-family:'NanumMyeongjo',serif;font-weight:700;font-size:21px;
  line-height:1.62;letter-spacing:-.03em;color:var(--ink)}
.pcard__ic{color:var(--ink-4);margin-top:24px}
.pcard__ic svg{width:38px;height:38px}
.pcard__i{position:relative;overflow:hidden;background:var(--cream)}
.pcard__i img{position:absolute;inset:0}

.story{padding:92px 60px 96px;display:grid;grid-template-columns:1fr 1.05fr;
  gap:44px;align-items:center;background:var(--cream)}
.story__h{font-family:'NanumMyeongjo',serif;font-weight:800;font-size:38px;
  line-height:1.46;letter-spacing:-.03em;color:var(--ink)}
.story .rule{width:40px;height:1.5px;background:var(--ink-4);margin:28px 0 24px}
.story__b{font-size:12.5px;line-height:2.05;color:var(--ink-2);word-break:keep-all}
`,

  render({ p, img }) {
    const q = p.problem;
    const cards = q.items.map((it, i) => `
      <div class="pcard ${i === 1 ? 'pcard--flip' : ''}">
        <div class="pcard__t">
          <div class="pcard__no">${esc(it.no)}</div>
          <div class="pcard__h">${br(it.title)}</div>
          <div class="pcard__ic">${icon(it.icon)}</div>
        </div>
        <div class="pcard__i"><img src="${esc(img.pick(i === 2 ? 'hero' : 'life', i))}" alt=""></div>
      </div>`).join('');

    return `
<div class="page">
  <section class="head">
    <div class="display">${br(q.headline)}</div>
    <div class="tick tick--v"></div>
  </section>

  <section class="cards">${cards}</section>

  <section class="story">
    <div>
      <div class="story__h">${br(q.story.headline)}</div>
      <div class="rule"></div>
      <div class="story__b">${br(q.story.body)}</div>
    </div>
    ${shot(img.pick('closeup', 0), 'r-1x1', 'shot--lg')}
  </section>
</div>`;
  },
};
