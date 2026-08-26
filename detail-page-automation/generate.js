#!/usr/bin/env node
'use strict';
/**
 * 상세페이지 대량 생산기
 *
 *   node generate.js graydoll              그레이돌 상세페이지 5종 생성
 *   node generate.js --all                 products/ 안의 모든 제품 생성
 *   node generate.js graydoll --format 3   3번 형식만 다시 생성
 *   node generate.js graydoll --keep-html  디버깅용 HTML 도 함께 저장
 *   node generate.js graydoll --out "D:/kokringadmin-main/kokring_shangpei"
 *   node generate.js graydoll --images "D:/kokringadmin-main/kokring_shangpei/Grip+doll"
 */
const fs = require('fs');
const path = require('path');
const { collect } = require('./lib/images');
const { loadAll } = require('./lib/templates');
const { Renderer } = require('./lib/render');

const PRODUCTS_DIR = path.join(__dirname, 'products');
const OUTPUT_DIR = path.join(__dirname, 'output');

function parseArgs(argv) {
  const opts = { slugs: [], all: false, formats: null, scale: 2, keepHtml: false, out: OUTPUT_DIR, images: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--format' || a === '-f') opts.formats = argv[++i].split(',').map(Number);
    else if (a === '--scale') opts.scale = Number(argv[++i]);
    else if (a === '--keep-html') opts.keepHtml = true;
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--images') opts.images = path.resolve(argv[++i]);
    else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`);
    else opts.slugs.push(a);
  }
  return opts;
}

function listProducts() {
  if (!fs.existsSync(PRODUCTS_DIR)) return [];
  return fs.readdirSync(PRODUCTS_DIR)
    .filter((d) => fs.existsSync(path.join(PRODUCTS_DIR, d, 'product.json')));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slugs = opts.all ? listProducts() : opts.slugs;

  if (slugs.length === 0) {
    const available = listProducts();
    console.error('사용법: node generate.js <제품명> | --all');
    console.error(available.length ? `등록된 제품: ${available.join(', ')}` : 'products/ 에 제품이 없습니다.');
    process.exit(1);
  }

  let templates = loadAll();
  if (opts.formats) {
    templates = templates.filter((t) => opts.formats.includes(t.id));
    if (!templates.length) throw new Error(`해당 형식이 없습니다: ${opts.formats.join(',')}`);
  }

  const renderer = new Renderer({ scale: opts.scale, keepHtml: opts.keepHtml });
  const started = Date.now();
  let made = 0;
  const warnings = [];

  try {
    for (const slug of slugs) {
      const dir = path.join(PRODUCTS_DIR, slug);
      const productFile = path.join(dir, 'product.json');
      if (!fs.existsSync(productFile)) throw new Error(`product.json 이 없습니다: ${productFile}`);

      const p = JSON.parse(fs.readFileSync(productFile, 'utf8'));
      // --images 로 제품 폴더 밖의 사진 폴더를 그대로 쓸 수 있다.
      const img = collect(opts.images || path.join(dir, 'images'));
      const ctx = { p, img };

      console.log(`\n[${slug}] ${p.name.ko} — 형식 ${templates.length}종`);

      for (const t of templates) {
        const outPath = path.join(opts.out, slug, `${slug}_${t.id}.png`);
        const r = await renderer.renderToFile(t, ctx, outPath);
        made++;
        const kb = (r.bytes / 1024).toFixed(0);
        console.log(`  ✓ ${slug}_${t.id}.png  ${t.name}  ${r.width}×${r.height}  ${kb}KB`);
        if (r.broken.length) {
          warnings.push(`${slug}_${t.id}: 이미지 ${r.broken.length}개 로드 실패`);
        }
      }
    }
  } finally {
    await renderer.close();
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n완료: ${made}장 / ${secs}초 → ${opts.out}`);
  if (warnings.length) {
    console.log('\n주의:');
    for (const w of warnings) console.log('  - ' + w);
  }
}

main().catch((e) => { console.error('\n오류:', e.message); process.exit(1); });
