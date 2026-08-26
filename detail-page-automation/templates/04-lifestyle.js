'use strict';
const { esc, br, shot, badge, iconItem, iconItemCss } = require('../lib/parts');

module.exports = {
  id: 4,
  key: 'lifestyle',
  name: '라이프스타일',
  description: '실제 사용 장면을 크게 쌓아 보여주고, 선택할 이유 네 가지로 정리한다.',

  css: `
${iconItemCss}
.page{background:var(--cream-2)}
.head{padding:44px 60px 0;text-align:center}
.head .badge{margin:0 auto 26px}
.head .display{font-size:35px;font-weight:800}
.head .tick{margin-top:20px}

.scenes{padding:40px 32px 0;display:flex;flex-direction:column;gap:14px}

.reasons{padding:64px 44px 62px;text-align:center}
.reasons__h{font-family:'NanumMyeongjo',serif;font-weight:800;font-size:25px;
  letter-spacing:-.03em;color:var(--ink)}
.reasons__l{display:grid;grid-template-columns:repeat(4,1fr);margin-top:40px}
.reasons__l > * + *{border-left:1px solid var(--line)}
`,

  render({ p, img }) {
    const l = p.lifestyle;
    const scenes = [0, 1, 2, 3]
      .map((i) => shot(img.pick('life', i), 'r-2x1', 'shot--lg')).join('');

    return `
<div class="page">
  <section class="head">
    ${badge(p.brand, true)}
    <div class="display">${br(l.headline)}</div>
    <div class="tick"></div>
  </section>

  <section class="scenes">${scenes}</section>

  <section class="reasons">
    <div class="reasons__h">${esc(l.reasonsTitle)}</div>
    <div class="tick"></div>
    <div class="reasons__l">${l.reasons.map((r) => iconItem(r.icon, r.label)).join('')}</div>
  </section>
</div>`;
  },
};
