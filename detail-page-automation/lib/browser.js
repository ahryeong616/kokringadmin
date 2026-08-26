'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/**
 * 환경마다 Playwright가 기대하는 Chromium 리비전이 다를 수 있어서
 * 기본 실행을 먼저 시도하고, 실패하면 설치된 바이너리를 직접 찾는다.
 * (윈도우 PC에서는 대개 기본 실행으로 바로 성공한다.)
 */
function findLocalChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return null;

  const candidates = [];
  for (const dir of fs.readdirSync(root)) {
    if (!/^chromium/.test(dir)) continue;
    for (const rel of [
      'chrome-linux/chrome',
      'chrome-linux/headless_shell',
      'chrome-win/chrome.exe',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const full = path.join(root, dir, rel);
      if (fs.existsSync(full)) candidates.push(full);
    }
  }
  // headless_shell 보다 전체 chrome 을 우선한다 (폰트/렌더링 옵션이 더 완전함)
  candidates.sort((a, b) => (a.includes('headless_shell') ? 1 : 0) - (b.includes('headless_shell') ? 1 : 0));
  return candidates[0] || null;
}

async function launch() {
  const args = ['--allow-file-access-from-files', '--font-render-hinting=none'];
  try {
    return await chromium.launch({ args });
  } catch (err) {
    const exe = findLocalChromium();
    if (!exe) throw err;
    return await chromium.launch({ executablePath: exe, args });
  }
}

module.exports = { launch, findLocalChromium };
