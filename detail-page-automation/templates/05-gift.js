'use strict';
const { esc, br, shot, icon, stars, iconItemCss } = require('../lib/parts');

module.exports = {
  id: 5,
  key: 'gift',
  name: '선물 · 후기 · FAQ',
  description: '선물 수요를 짚고 후기와 FAQ로 망설임을 걷어낸 뒤 구매로 연결한다.',

  css: `
${iconItemCss}
.page{background:var(--cream-2)}

/* 상단: 왼쪽 카피 + 오른쪽 전면 사진 */
.top{display:grid;grid-template-columns:1fr 1.12fr;min-height:346px;align-items:center}
.top__t{padding:0 34px 0 60px}
.top__e{font-size:13px;font-weight:400;color:var(--ink-2);margin-bottom:14px}
.top__h{font-family:'NanumMyeongjo',serif;font-weight:800;font-size:33px;
  letter-spacing:-.03em;color:var(--ink)}
.top__s{font-size:12px;color:var(--ink-3);margin-top:20px;line-height:1.8}
.top__i{position:relative;align-self:stretch;overflow:hidden;background:var(--cream-3)}
.top__i img{position:absolute;inset:0}

/* 추천 대상 5분할 */
.who{padding:34px 30px 0;display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.who__c .shot{border-radius:var(--r-sm)}
.who__b{background:var(--cream-3);border-radius:var(--r-sm);margin-top:8px;
  padding:16px 6px 15px;text-align:center}
.who__b .ico{width:30px;height:30px;border:0;color:var(--ink-3)}
.who__b .ico svg{width:21px;height:21px}
.who__b .l{font-size:11px;font-weight:500;color:var(--ink-2);margin-top:8px;
  letter-spacing:-.03em;word-break:keep-all;line-height:1.4}

/* 후기 */
.sec-h{text-align:center;font-family:'NanumMyeongjo',serif;font-weight:800;
  font-size:24px;letter-spacing:-.03em;color:var(--ink)}
.reviews{padding:66px 40px 0}
.reviews__l{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:34px}
/* 후기 길이가 달라도 카드 높이와 별점 위치가 어긋나지 않게 한다 */
.rv{background:var(--cream-3);border-radius:var(--r);padding:34px 22px 28px;text-align:center;
  display:flex;flex-direction:column;height:100%}
.rv .stars{margin-top:auto}
.rv__q{color:var(--ink-4)}
.rv__q svg{width:20px;height:15px;margin:0 auto}
.rv__t{font-size:13.5px;font-weight:500;line-height:1.85;color:var(--ink);
  margin:18px 0 20px;letter-spacing:-.03em;word-break:keep-all}

/* FAQ */
.faq{padding:70px 44px 0}
.faq__l{margin-top:34px}
.fq{display:grid;grid-template-columns:1fr 20px;align-items:start;gap:12px;
  padding:20px 4px;border-bottom:1px solid var(--line)}
.fq:first-child{border-top:1px solid var(--line)}
.fq__q{font-size:13.5px;font-weight:700;color:var(--ink);letter-spacing:-.03em}
.fq__q b{color:var(--green);font-weight:700;margin-right:7px}
.fq__a{font-size:11.5px;color:var(--ink-3);margin-top:9px;line-height:1.7;padding-left:17px}
.fq__c{color:var(--ink-4);padding-top:2px}
.fq__c svg{width:15px;height:15px}

/* 구매 유도 */
.cta{margin:70px 30px 34px;background:var(--cream-3);border-radius:var(--r-lg);
  display:grid;grid-template-columns:1fr 1.06fr;overflow:hidden;min-height:300px}
.cta__t{padding:48px 30px 48px 46px;display:flex;flex-direction:column;justify-content:center}
.cta__h{font-family:'NanumMyeongjo',serif;font-weight:800;font-size:29px;
  line-height:1.5;letter-spacing:-.03em;color:var(--ink)}
.cta__b{font-size:12px;line-height:1.85;color:var(--ink-2);margin:20px 0 30px}
.cta__btn{align-self:flex-start;background:var(--green);color:#fff;border-radius:6px;
  padding:13px 30px;font-size:13.5px;font-weight:600;letter-spacing:-.02em}
.cta__i{position:relative;overflow:hidden}
.cta__i img{position:absolute;inset:0}
`,

  render({ p, img }) {
    const g = p.gift;

    const who = g.recipients.map((r, i) => `
      <div class="who__c">
        ${shot(img.pick(i % 2 ? 'people' : 'life', i), 'r-3x4')}
        <div class="who__b">
          <div class="ico">${icon(r.icon)}</div>
          <div class="l">${br(r.label)}</div>
        </div>
      </div>`).join('');

    const reviews = g.reviews.map((r) => `
      <div class="rv">
        <div class="rv__q">${icon('quote')}</div>
        <div class="rv__t">${br(r.quote)}</div>
        ${stars(r.stars)}
      </div>`).join('');

    const faq = g.faq.map((f) => `
      <div class="fq">
        <div>
          <div class="fq__q"><b>Q.</b>${esc(f.q)}</div>
          <div class="fq__a">${esc(f.a)}</div>
        </div>
        <div class="fq__c">${icon('chevron')}</div>
      </div>`).join('');

    return `
<div class="page">
  <section class="top">
    <div class="top__t">
      <div class="top__e">${esc(g.eyebrow)}</div>
      <div class="top__h">${br(g.headline)}</div>
      <div class="top__s">${esc(g.sub)}</div>
    </div>
    <div class="top__i"><img src="${esc(img.pick('hero', 0))}" alt=""></div>
  </section>

  <section class="who">${who}</section>

  <section class="reviews">
    <div class="sec-h">${esc(g.reviewsTitle)}</div>
    <div class="tick tick--dark"></div>
    <div class="reviews__l">${reviews}</div>
  </section>

  <section class="faq">
    <div class="sec-h">${esc(g.faqTitle)}</div>
    <div class="tick tick--dark"></div>
    <div class="faq__l">${faq}</div>
  </section>

  <section class="cta">
    <div class="cta__t">
      <div class="cta__h">${br(g.cta.headline)}</div>
      <div class="cta__b">${br(g.cta.body)}</div>
      <div class="cta__btn">${esc(g.cta.button)}</div>
    </div>
    <div class="cta__i"><img src="${esc(img.pick('life', 3))}" alt=""></div>
  </section>
</div>`;
  },
};
