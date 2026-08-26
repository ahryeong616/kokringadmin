'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'templates');

/** templates/ 안의 NN-이름.js 를 번호순으로 모두 읽어온다. */
function loadAll() {
  return fs.readdirSync(DIR)
    .filter((f) => /^\d+-.*\.js$/.test(f))
    .sort()
    .map((f) => {
      const t = require(path.join(DIR, f));
      if (typeof t.render !== 'function') throw new Error(`${f}: render() 가 없습니다`);
      return t;
    });
}

module.exports = { loadAll, DIR };
