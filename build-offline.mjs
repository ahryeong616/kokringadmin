// 현장_시세조사.html → 인터넷 없이 동작하는 단일 파일(현장_시세조사_오프라인.html)로 묶는다.
//
//   node build-offline.mjs
//
// 필요한 원본(vendor/): tesseract.min.js, worker.min.js,
//                      tesseract-core-simd-lstm.wasm.js, kor.traineddata.gz, eng.traineddata.gz
// tesseract.js@5 / tesseract.js-core@5 패키지와 tessdata_fast 에서 가져온 파일들이다.
import fs from 'node:fs';
import path from 'node:path';

const V = 'vendor';
const need = ['tesseract.min.js','worker.min.js','tesseract-core-simd-lstm.wasm.js',
              'kor.traineddata.gz','eng.traineddata.gz'];
const missing = need.filter(f => !fs.existsSync(path.join(V, f)));
if (missing.length) {
  console.error('vendor/ 에 다음 파일이 없습니다:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const read = f => fs.readFileSync(path.join(V, f), 'utf8');
const b64  = f => fs.readFileSync(path.join(V, f)).toString('base64');

// </script> 가 텍스트 안에 있으면 HTML 파서가 블록을 일찍 닫아버린다
const safe = t => t.replace(/<\/script>/gi, '<\\/script>');

const src = fs.readFileSync('현장_시세조사.html', 'utf8');

const blocks = [
  `<script>${safe(read('tesseract.min.js'))}</script>`,
  `<script type="text/plain" id="emb-worker">${safe(read('worker.min.js'))}</script>`,
  `<script type="text/plain" id="emb-core">${safe(read('tesseract-core-simd-lstm.wasm.js'))}</script>`,
  `<script type="text/plain" id="emb-kor">${b64('kor.traineddata.gz')}</script>`,
  `<script type="text/plain" id="emb-eng">${b64('eng.traineddata.gz')}</script>`,
].join('\n');

const marker = '<script>\n/* ====';
if (!src.includes(marker)) { console.error('앱 스크립트 시작 지점을 찾지 못했습니다.'); process.exit(1); }

const out = src
  .replace('<title>현장 시세조사 · 사진 자동입력</title>',
           '<title>현장 시세조사 · 사진 자동입력</title>')
  .replace(marker, blocks + '\n' + marker);

const name = '현장_시세조사_오프라인.html';
fs.writeFileSync(name, out);
const mb = (Buffer.byteLength(out) / 1048576).toFixed(2);
console.log(`${name} 생성 완료 — ${mb} MB (인터넷 불필요)`);
