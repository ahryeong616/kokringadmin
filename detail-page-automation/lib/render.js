'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./browser');
const { documentShell } = require('./theme');

/**
 * 여러 템플릿을 한 브라우저 인스턴스로 연속 렌더링한다.
 * 브라우저 기동이 가장 비싼 작업이라 제품/템플릿 수가 늘어도 한 번만 띄운다.
 */
class Renderer {
  constructor(opts = {}) {
    this.scale = opts.scale || 2;      // 2배 해상도로 저장 (상세페이지는 고해상도가 기본)
    this.width = opts.width || 860;
    this.keepHtml = !!opts.keepHtml;
    this.browser = null;
  }

  async open() {
    if (!this.browser) this.browser = await launch();
    return this.browser;
  }

  async close() {
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }

  /** 템플릿 하나를 PNG 로 저장하고 저장 경로/크기를 돌려준다. */
  async renderToFile(template, ctx, outPath) {
    const browser = await this.open();
    const width = template.width || this.width;
    const html = documentShell({ css: template.css || '', body: template.render(ctx), width });

    const page = await browser.newPage({
      viewport: { width, height: 1200 },
      deviceScaleFactor: this.scale,
    });

    // about:blank 상태에서는 file:// 이미지가 origin 정책에 막히므로
    // HTML 을 임시 파일로 써서 file:// 페이지로 연다.
    const tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-')), 'page.html');
    fs.writeFileSync(tmpFile, html, 'utf8');

    try {
      await page.goto('file://' + tmpFile.replace(/\\/g, '/'), { waitUntil: 'load' });
      // 폰트와 이미지가 모두 준비된 뒤에 찍어야 레이아웃이 어긋나지 않는다.
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => {
        const imgs = [...document.images].filter((i) => !i.complete);
        await Promise.all(imgs.map((i) => new Promise((res) => {
          i.addEventListener('load', res, { once: true });
          i.addEventListener('error', res, { once: true });
        })));
      });

      const broken = await page.evaluate(() =>
        [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await page.screenshot({ path: outPath, fullPage: true });

      if (this.keepHtml) {
        fs.writeFileSync(outPath.replace(/\.png$/i, '.html'), html, 'utf8');
      }

      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      return { outPath, width, height, broken, bytes: fs.statSync(outPath).size };
    } finally {
      await page.close();
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    }
  }
}

module.exports = { Renderer };
