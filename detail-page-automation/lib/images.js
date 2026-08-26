'use strict';
const fs = require('fs');
const path = require('path');

const EXT = /\.(png|jpe?g|webp|avif|gif|svg)$/i;

// 파일명 앞부분으로 역할을 지정할 수 있다. (예: hero_01.jpg, angle_front.png)
const ROLE_PATTERNS = [
  ['hero',     /^(hero|main|대표|메인)/i],
  ['angle',    /^(angle|side|back|front|각도|측면|후면)/i],
  ['closeup',  /^(close ?up|detail|디테일|클로즈업)/i],
  ['lifestyle',/^(life ?style|scene|package|연출|패키지)/i],
];

function roleOf(filename) {
  const base = path.basename(filename);
  for (const [role, re] of ROLE_PATTERNS) if (re.test(base)) return role;
  return null;
}

/** 자연 정렬: img2 가 img10 보다 앞에 오도록 */
function naturalSort(a, b) {
  return a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });
}

/**
 * 제품 이미지 폴더를 읽어 역할별로 분류한다.
 * 역할 접두사가 없으면 순서대로 hero → angle → closeup → lifestyle 로 배분한다.
 */
function collect(imageDir) {
  if (!fs.existsSync(imageDir)) {
    throw new Error(`이미지 폴더가 없습니다: ${imageDir}`);
  }
  const files = fs.readdirSync(imageDir).filter((f) => EXT.test(f)).sort(naturalSort);
  if (files.length === 0) {
    throw new Error(`이미지 폴더가 비어 있습니다: ${imageDir}`);
  }

  const buckets = { hero: [], angle: [], closeup: [], lifestyle: [] };
  const unassigned = [];

  for (const f of files) {
    const url = toFileUrl(path.join(imageDir, f));
    const role = roleOf(f);
    if (role) buckets[role].push(url);
    else unassigned.push(url);
  }

  // 접두사가 없는 이미지는 비어 있는 역할부터 순서대로 채운다.
  const fillOrder = [['hero', 1], ['angle', 4], ['closeup', 2], ['lifestyle', 2]];
  for (const [role, want] of fillOrder) {
    while (buckets[role].length < want && unassigned.length > 0) {
      buckets[role].push(unassigned.shift());
    }
  }
  // 남은 이미지는 angle 에 몰아둔다.
  buckets.angle.push(...unassigned);

  const all = files.map((f) => toFileUrl(path.join(imageDir, f)));

  return {
    ...buckets,
    all,
    /** 역할별 이미지가 모자랄 때 전체 목록에서 순환 참조로 채운다. */
    pick(role, index) {
      const list = buckets[role].length ? buckets[role] : all;
      return list[index % list.length];
    },
    take(role, count) {
      return Array.from({ length: count }, (_, i) => this.pick(role, i));
    },
  };
}

function toFileUrl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return 'file://' + (abs.startsWith('/') ? '' : '/') + encodeURI(abs);
}

module.exports = { collect, toFileUrl, naturalSort };
