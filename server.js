/* ==========================================================================
   현장 시세조사 — 동기화 서버
   재고관리(kokringadmin)와 아무것도 공유하지 않는 별개 앱입니다.
   같은 저장소의 'survey' 브랜치에만 있으므로, main 을 보는 재고관리 배포에는
   영향을 주지 않습니다.
   ========================================================================== */
const path = require('path');
const express = require('express');
const mariadb = require('mariadb');

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_KEY = process.env.APP_ACCESS_KEY || '';

// Railway 에서 MySQL 을 붙이면 MYSQL_URL / MYSQL_PRIVATE_URL 이 생깁니다.
// 같은 프로젝트 안에서는 private 쪽이 빠르고 요금도 들지 않아 먼저 씁니다.
function databaseUrl() {
  return process.env.DATABASE_URL
    || process.env.MYSQL_PRIVATE_URL
    || process.env.DATABASE_PRIVATE_URL
    || process.env.MYSQL_URL
    || '';
}

function buildDbConfig() {
  const url = new URL(databaseUrl());
  const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true'
    || (url.searchParams.get('ssl-mode') || '').toUpperCase() === 'REQUIRED';
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || undefined,
    connectionLimit: 5,
    acquireTimeout: 15000,
    // MySQL 8 은 caching_sha2_password 로 인증합니다. 암호화하지 않은 연결에서
    // 첫 접속을 하려면 서버 공개키를 받아와야 하는데, 이 옵션이 없으면 거기서 실패합니다.
    allowPublicKeyRetrieval: true,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/* ── 준비 상태 ─────────────────────────────────────────────────────────
   웹 서버는 무조건 먼저 켭니다. 데이터베이스 연결은 뒤에서 따로 진행하고,
   준비되기 전에는 API 가 503 으로 이유를 알려 줍니다.
   이렇게 해야 DB 가 늦게 뜨거나 설정이 틀려도 'Application failed to respond'
   같은 무응답 상태가 되지 않고, 화면에서 원인을 볼 수 있습니다. ── */
let pool = null;
let dbReady = false;
let dbError = '데이터베이스에 연결하는 중입니다…';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const eventClients = new Set();
function broadcast() {
  const payload = `event: change\ndata: ${Date.now()}\n\n`;
  for (const client of eventClients) {
    try { client.write(payload); } catch (_) { /* 끊긴 연결은 무시 */ }
  }
}

// 상태 확인용. 접속 비밀번호 없이도 볼 수 있게 두어, 배포가 살아 있는지 바로 확인합니다.
app.get('/healthz', (req, res) => {
  res.json({ ok: true, db: dbReady, detail: dbReady ? 'ready' : dbError });
});

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('event: connected\ndata: ok\n\n');
  eventClients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { /* 무시 */ }
  }, 25000);
  req.on('close', () => { clearInterval(heartbeat); eventClients.delete(res); });
});

function guard(req, res, next) {
  if (!ACCESS_KEY) {
    return res.status(503).json({ message: '서버에 APP_ACCESS_KEY 가 설정되지 않았습니다.' });
  }
  if (req.get('x-kokring-access-key') !== ACCESS_KEY) {
    return res.status(401).json({ message: '접속 비밀번호가 맞지 않습니다.' });
  }
  if (!dbReady) return res.status(503).json({ message: dbError });
  next();
}
app.use('/api', guard);

const MAX_PAYLOAD = 256 * 1024;   // 기록 한 건 상한
const MAX_BATCH = 500;

// 마지막으로 받아간 시각 이후에 바뀐 것만 내려줍니다(지운 것 포함).
app.get('/api/survey/changes', async (req, res, next) => {
  let conn;
  try {
    const raw = Number(req.query.since);
    const since = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT uid, updated_at, deleted, payload FROM survey_records WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 5000',
      [since],
    );
    res.set('Cache-Control', 'no-store').json({
      now: Date.now(),
      records: rows.map((r) => ({
        uid: r.uid,
        updatedAt: Number(r.updated_at),
        deleted: Number(r.deleted) === 1,
        rec: r.payload ? JSON.parse(r.payload) : null,
      })),
    });
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

// 기기에서 바뀐 것을 올립니다. 같은 uid 는 updated_at 이 큰 쪽만 남습니다.
app.post('/api/survey/push', async (req, res, next) => {
  let conn;
  try {
    const list = Array.isArray(req.body?.records) ? req.body.records : [];
    if (list.length > MAX_BATCH) {
      return res.status(400).json({ message: `한 번에 ${MAX_BATCH}건까지 보낼 수 있습니다.` });
    }
    conn = await pool.getConnection();
    let applied = 0;
    for (const item of list) {
      const uid = String(item?.uid || '').slice(0, 64);
      if (!uid) continue;
      const updatedAt = Number(item?.updatedAt) || Date.now();
      const deleted = item?.deleted ? 1 : 0;
      const payload = deleted ? null : JSON.stringify(item?.rec ?? null);
      if (payload && payload.length > MAX_PAYLOAD) continue;   // 너무 큰 건은 건너뜁니다
      await conn.query(
        `INSERT INTO survey_records (uid, updated_at, deleted, payload) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           payload    = IF(VALUES(updated_at) >= updated_at, VALUES(payload), payload),
           deleted    = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted),
           updated_at = IF(VALUES(updated_at) >= updated_at, VALUES(updated_at), updated_at)`,
        [uid, updatedAt, deleted, payload],
      );
      applied += 1;
    }
    if (applied) broadcast();
    res.json({ ok: true, applied, now: Date.now() });
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
});

/* ── 데이터베이스 준비 (웹 서버와 따로 진행) ── */
async function prepareDatabase() {
  if (!databaseUrl()) {
    dbError = 'DATABASE_URL 이 설정되지 않았습니다. 배포처 환경변수에 MySQL 주소를 넣어 주세요.';
    console.error(dbError);
    return;
  }
  pool = mariadb.createPool(buildDbConfig());
  for (let attempt = 1; ; attempt += 1) {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.query(`
        CREATE TABLE IF NOT EXISTS survey_records (
          uid VARCHAR(64) NOT NULL PRIMARY KEY,
          updated_at BIGINT NOT NULL,
          deleted TINYINT NOT NULL DEFAULT 0,
          payload LONGTEXT NULL,
          KEY idx_survey_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      dbReady = true;
      console.log('데이터베이스 준비 완료');
      return;
    } catch (err) {
      dbError = `데이터베이스에 연결하지 못했습니다 (${err.code || err.message}).`;
      console.error(`${dbError} 재시도 ${attempt}회`);
      // 웹 서버는 이미 떠 있으므로, 끝없이 재시도해도 화면은 계속 응답합니다.
      await new Promise((r) => setTimeout(r, Math.min(30000, 3000 * attempt)));
    } finally { if (conn) conn.release(); }
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`시세조사 서버 시작 — 포트 ${PORT}`);
  if (!ACCESS_KEY) console.error('경고: APP_ACCESS_KEY 가 없습니다. 동기화 API 가 동작하지 않습니다.');
  prepareDatabase();
});
