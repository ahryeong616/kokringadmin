'use strict';
/**
 * 실제 상품 사진이 준비되기 전에 레이아웃을 확인하기 위한 임시 이미지 생성기.
 * 진짜 사진을 products/<제품>/images 에 넣으면 이 파일들은 지워도 된다.
 */
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || path.join(__dirname, '..', 'products', 'graydoll', 'images');

const SHOTS = [
  ['hero_01',    'HERO',      900, 1400],
  ['front_01',   'FRONT',     700, 850],
  ['side_01',    'SIDE A',    700, 850],
  ['side_02',    'SIDE B',    700, 850],
  ['closeup_01', 'DETAIL 1',  800, 600],
  ['closeup_02', 'DETAIL 2',  800, 600],
  ['closeup_03', 'DETAIL 3', 1200, 600],
  ['closeup_04', 'DETAIL 4',  800, 600],
  ['closeup_05', 'DETAIL 5',  800, 600],
  ['life_01',    'SCENE 1',  1200, 600],
  ['life_02',    'SCENE 2',  1200, 600],
  ['life_03',    'SCENE 3',  1200, 600],
  ['life_04',    'SCENE 4',  1200, 600],
  ['people_01',  'MODEL 1',   700, 900],
  ['people_02',  'MODEL 2',   700, 900],
];

const svg = (label, w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="#fbfbfc"/><stop offset="55%" stop-color="#eef0f2"/><stop offset="100%" stop-color="#dfe3e7"/>
    </linearGradient>
    <linearGradient id="obj" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#c8ccd1"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="${w * 0.72}" y="0" width="${w * 0.28}" height="${h}" fill="#2b3138" opacity="0.85"/>
  <circle cx="${w * 0.44}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.17}" fill="url(#obj)"/>
  <rect x="${w * 0.44 - Math.min(w, h) * 0.055}" y="${h * 0.3}" width="${Math.min(w, h) * 0.11}" height="${h * 0.42}"
        rx="${Math.min(w, h) * 0.055}" fill="url(#obj)"/>
  <text x="50%" y="${h - 34}" text-anchor="middle" font-family="monospace" font-size="${Math.round(Math.min(w, h) * 0.045)}"
        fill="#8a9099" letter-spacing="3">${label} · PLACEHOLDER</text>
</svg>`;

fs.mkdirSync(outDir, { recursive: true });
for (const [name, label, w, h] of SHOTS) {
  fs.writeFileSync(path.join(outDir, `${name}.svg`), svg(label, w, h), 'utf8');
}
console.log(`${SHOTS.length}개 임시 이미지 생성: ${outDir}`);
