#!/usr/bin/env bash
# =============================================================================
# 리뷰 이벤트 배너 렌더링 스크립트
# -----------------------------------------------------------------------------
#  사용법 :  ./build.sh
#  준비물 :  같은 폴더에 원본 이미지 2개를 둔다.
#              logo.png   - EGEN AUTO 로고 원본 (여백이 넓어도 상관없음)
#              model.png  - 모델 캐릭터 시트 원본
#  필요도구:  python3(+Pillow, numpy), 헤드리스 Chrome/Chromium, curl
#  결과물 :  banner.png  (가로 1720px = 860px 조판의 2배 해상도)
# =============================================================================
set -e
cd "$(dirname "$0")"

# ── 0) Chrome 실행 파일 탐색 ────────────────────────────────────────────────
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || echo /opt/chrome-full/chrome)}"
[ -x "$CHROME" ] || { echo "Chrome을 찾지 못했습니다. CHROME=<경로> 로 지정하세요."; exit 1; }

# ── 1) Pretendard 폰트 설치 (이미 있으면 건너뜀) ────────────────────────────
if ! fc-list | grep -qi pretendard; then
  echo "· Pretendard 내려받는 중..."
  mkdir -p .fonts && for w in Black ExtraBold Bold Medium Regular; do
    curl -sS -f -o ".fonts/$w.otf" \
      "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-$w.otf"
  done
  mkdir -p ~/.fonts && cp .fonts/*.otf ~/.fonts/ && fc-cache -f >/dev/null 2>&1
fi

# ── 2) 원본 이미지 전처리 ───────────────────────────────────────────────────
echo "· 로고 여백 제거 / 모델 상반신 크롭..."
mkdir -p assets
python3 - <<'PY'
from PIL import Image, ImageChops

# [로고] 원본에 사방 여백이 넓게 들어가 있으므로 실제로 그려진 영역만 남긴다.
lg = Image.open('logo.png').convert('RGBA')
if lg.getchannel('A').getextrema()[0] < 250:          # 배경이 투명한 경우
    box = lg.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
else:                                                  # 배경이 불투명 흰색인 경우
    diff = ImageChops.difference(lg.convert('RGB'),
                                 Image.new('RGB', lg.size, (255, 255, 255))).convert('L')
    box = diff.point(lambda v: 255 if v > 12 else 0).getbbox()
lg = lg.crop(box)
w, h = lg.size
lg.resize((900, round(h * 900 / w)), Image.LANCZOS).save('assets/logo_trim.png')
print('  로고 bbox', box)

# [모델] 캐릭터 시트에서 상단 히어로 상반신 컷(x 37~545, y 29~508)만 사용한다.
#        얼굴이 가로 중앙(x≈291)에 있으므로 그 중심 기준 폭 360으로 잘라 3:4를 만든다.
#        ※ 다른 컷을 쓰려면 아래 crop 좌표만 바꾸면 된다.
Image.open('model.png').convert('RGB') \
     .crop((111, 29, 471, 509)) \
     .resize((720, 960), Image.LANCZOS) \
     .save('assets/model_crop.png')
print('  모델 크롭 완료')
PY

# ── 3) 렌더링 ───────────────────────────────────────────────────────────────
#    배경을 마젠타로 두고 캡처한 뒤, 마젠타가 아닌 영역만 잘라 정확히 재단한다.
echo "· 렌더링..."
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --force-device-scale-factor=2 \
  --window-size=900,1300 --default-background-color=FF00FF \
  --virtual-time-budget=6000 --screenshot=raw.png "file://$PWD/banner.html" 2>/dev/null

python3 - <<'PY'
from PIL import Image
import numpy as np
im = Image.open('raw.png').convert('RGB')
a = np.asarray(im)
mask = ~((a[:, :, 0] > 240) & (a[:, :, 1] < 40) & (a[:, :, 2] > 240))   # 마젠타가 아닌 픽셀
ys, xs = np.where(mask.any(axis=1))[0], np.where(mask.any(axis=0))[0]
out = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
out.save('banner.png')
print('  완료 → banner.png', out.size)
PY
rm -f raw.png
