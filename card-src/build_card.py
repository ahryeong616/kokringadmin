import base64, pathlib

font_b64 = base64.b64encode(pathlib.Path('SebangGothicBold.woff').read_bytes()).decode()
img_b64  = base64.b64encode(pathlib.Path('model_clean.png').read_bytes()).decode()

html = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
@font-face{
  font-family:'SebangGothic';
  src:url(data:font/woff;base64,__FONT__) format('woff');
  font-weight:400 900;font-style:normal;font-display:block;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px}
body{
  font-family:'SebangGothic','Noto Sans KR',sans-serif;
  background:#E8F0FE;
  -webkit-font-smoothing:antialiased;
  word-break:keep-all;
}
.card{position:relative;width:1080px;height:1080px;overflow:hidden;background:#E8F0FE}

/* 상단 브랜드 라인 */
.brand{position:absolute;left:72px;top:58px;display:flex;align-items:center;gap:16px}
.brand .n{font-size:30px;letter-spacing:0.02em;color:#0B44C7}
.brand .sep{width:3px;height:28px;background:#A9BEE4;border-radius:2px}
.brand .t{font-size:26px;letter-spacing:0.14em;color:#5E749B}

/* 헤드라인 */
.head{position:absolute;left:72px;top:126px;line-height:1.14;letter-spacing:-0.045em;color:#111827}
.head .l1{font-size:96px}
.head .l2{font-size:96px;color:#111827}
.head .l2 em{font-style:normal;color:#F04E23}

/* 금액 */
.money{position:absolute;left:72px;top:410px;width:530px}
.money .cap{font-size:34px;letter-spacing:-0.03em;color:#3D4C69;margin-bottom:6px}
.money .cap b{color:#0B44C7}
.money .big{display:flex;align-items:baseline;gap:6px;color:#F04E23;letter-spacing:-0.045em}
.money .big .num{font-size:146px;line-height:0.98}
.money .big .won{font-size:66px}

/* 배지 */
.badge{position:absolute;left:72px;top:672px;display:inline-flex;align-items:center;gap:14px;
  background:#0B44C7;color:#fff;padding:18px 30px;border-radius:999px}
.badge .st{font-size:26px;letter-spacing:2px;color:#FFC53D}
.badge .tx{font-size:30px;letter-spacing:-0.03em}

/* 모델 */
.model{position:absolute;right:-6px;bottom:150px;height:566px;width:auto;display:block}

/* 하단 바 */
.bar{position:absolute;left:0;bottom:0;width:1080px;height:150px;background:#111827;
  display:flex;align-items:center}
.bar .col{flex:1;text-align:center;position:relative}
.bar .col + .col::before{content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:2px;height:66px;background:#2C374B}
.bar .lb{font-size:24px;letter-spacing:-0.02em;color:#9FB0CC;margin-bottom:8px}
.bar .am{font-size:48px;letter-spacing:-0.03em;color:#fff}
.bar .am.hi{color:#FFB020}

/* 대상 채널 */
.where{position:absolute;left:72px;top:790px;width:540px}
.where .k{font-size:25px;letter-spacing:-0.02em;color:#5E749B;margin-bottom:10px}
.where .v{font-size:31px;letter-spacing:-0.035em;color:#1B2C4A;line-height:1.5}
.where .v i{font-style:normal;color:#A9BEE4;margin:0 10px}
</style></head><body>
<div class="card">

  <div class="brand"><span class="n">EGEN AUTO</span><span class="sep"></span><span class="t">REVIEW EVENT</span></div>

  <div class="head">
    <div class="l1">사진 한 장이면</div>
    <div class="l2">후기가 <em>돈</em>이 됩니다</div>
  </div>

  <div class="money">
    <div class="cap">후기 <b>1건</b>으로 최대</div>
    <div class="big"><span class="num">15,150</span><span class="won">원</span></div>
  </div>

  <div class="badge"><span class="st">★★★★★</span><span class="tx">사진 1장 + 세 줄이면 끝</span></div>

  <div class="where">
    <div class="k">아래 사이트에 남긴 후기에서 선정합니다</div>
    <div class="v">자사몰<i>/</i>스마트스토어<i>/</i>네이버페이<br>이젠몰 · 이젠오토몰</div>
  </div>

  <img class="model" src="data:image/png;base64,__IMG__" alt="">

  <div class="bar">
    <div class="col"><div class="lb">쓰는 즉시 · 모든 분</div><div class="am">150원</div></div>
    <div class="col"><div class="lb">매주 금요일 14분</div><div class="am">최대 5,000원</div></div>
    <div class="col"><div class="lb">매월 첫째 주 3분</div><div class="am hi">10,000원</div></div>
  </div>

</div>
</body></html>"""

html = html.replace('__FONT__', font_b64).replace('__IMG__', img_b64)
pathlib.Path('card.html').write_text(html, encoding='utf-8')
print('card.html', len(html), 'chars')
