require('dotenv').config();

const path = require('path');
const express = require('express');
const mariadb = require('mariadb');

// 클라우드 배포 시에는 접속 URL 한 줄로 접속 정보를 받고,
// 로컬 실행 시에는 기존처럼 DB_HOST/DB_USER 등 개별 값을 사용합니다.
//
// Railway 에서 MySQL 를 붙이면 MYSQL_URL / MYSQL_PRIVATE_URL 이 자동으로 생깁니다.
// 그 값을 그대로 알아보게 해서, 사람이 직접 넣을 환경변수는 APP_ACCESS_KEY 하나로 줄입니다.
// 같은 프로젝트 안에서는 private 주소가 더 빠르고 요금도 들지 않으므로 먼저 씁니다.
function databaseUrl() {
  return process.env.DATABASE_URL
    || process.env.MYSQL_PRIVATE_URL
    || process.env.DATABASE_PRIVATE_URL
    || process.env.MYSQL_URL
    || '';
}

const required = databaseUrl()
  ? ['APP_ACCESS_KEY']
  : ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'APP_ACCESS_KEY'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// 원격 DB는 대부분 SSL(TLS) 연결을 요구합니다.
// DB_SSL=true 이거나 접속 URL에 ssl-mode=REQUIRED가 있으면 SSL을 켭니다.
function sslOption() {
  if (process.env.DB_SSL_CA) return { ca: process.env.DB_SSL_CA };
  return { rejectUnauthorized: false };
}

function buildDbConfig() {
  const base = { connectionLimit: 6, dateStrings: true, acquireTimeout: 15000 };
  const sslEnabled = String(process.env.DB_SSL || '').toLowerCase() === 'true';

  const dbUrl = databaseUrl();
  if (dbUrl) {
    const url = new URL(dbUrl);
    const useSsl = sslEnabled
      || url.protocol === 'mysqls:'
      || (url.searchParams.get('ssl-mode') || '').toUpperCase() === 'REQUIRED'
      || (url.searchParams.get('sslmode') || '').toLowerCase() === 'require';
    return {
      ...base,
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, '') || undefined,
      ...(useSsl ? { ssl: sslOption() } : {}),
    };
  }

  return {
    ...base,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ...(sslEnabled ? { ssl: sslOption() } : {}),
  };
}

const PORT = Number(process.env.PORT || 3000);
const app = express();
const pool = mariadb.createPool(buildDbConfig());

const eventClients = new Set();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

// 시세조사 앱은 /survey 로도 열린다 (현장에서 주소를 짧게 치려고)
app.get('/survey', (req, res) => res.sendFile(path.join(__dirname, 'survey.html')));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function integer(value, fallback = 0) {
  return Math.max(0, Math.trunc(number(value, fallback)));
}
function text(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}
function dateOnly(value) {
  const normalized = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}
function error(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
async function addColumnIfMissing(conn, table, column, definition) {
  try {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}
function broadcast() {
  const payload = `event: change\ndata: ${Date.now()}\n\n`;
  for (const client of eventClients) client.write(payload);
}

function accessKey(req, res, next) {
  if (req.get('x-kokring-access-key') !== process.env.APP_ACCESS_KEY) {
    return res.status(401).json({ message: '재고관리 접속 비밀번호가 맞지 않습니다.' });
  }
  next();
}

// ── 현장 시세조사 동기화 ───────────────────────────────────────────────
// 기기(폰·PC)마다 IndexedDB에 먼저 저장하고, 여기로 밀어 올려 서로 맞춘다.
// 기록 한 건을 통째로 JSON(payload)으로 두는 이유: 조사 항목이 자주 바뀌는데
// 그때마다 컬럼을 늘리면 배포가 번거롭기 때문. 충돌은 updated_at 이 큰 쪽이 이긴다.
async function ensureSurveySchema(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS survey_records (
      uid VARCHAR(64) NOT NULL PRIMARY KEY,
      updated_at BIGINT NOT NULL,
      deleted TINYINT NOT NULL DEFAULT 0,
      payload LONGTEXT NULL,
      KEY idx_survey_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureSchema() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(50) NOT NULL PRIMARY KEY,
        setting_value DECIMAL(15,2) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        product_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        product_code VARCHAR(30) NOT NULL UNIQUE,
        product_name VARCHAR(200) NOT NULL,
        product_option VARCHAR(200) NULL,
        supplier VARCHAR(200) NULL,
        base_sale_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        reorder_level INT UNSIGNED NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        purchase_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        purchase_date DATE NOT NULL,
        product_id BIGINT UNSIGNED NOT NULL,
        supplier VARCHAR(200) NULL,
        quantity INT UNSIGNED NOT NULL,
        currency ENUM('CNY','KRW') NOT NULL,
        unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        exchange_rate DECIMAL(15,4) NOT NULL DEFAULT 1,
        shipping_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        memo VARCHAR(1000) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_purchases_product FOREIGN KEY (product_id) REFERENCES products(product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing(conn, 'purchases', 'supplier', 'VARCHAR(200) NULL AFTER product_id');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS costs (
        cost_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        cost_date DATE NOT NULL,
        cost_name VARCHAR(200) NOT NULL,
        category VARCHAR(100) NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        allocation_type ENUM('allQty','allValue','product','business') NOT NULL DEFAULT 'business',
        product_id BIGINT UNSIGNED NULL,
        memo VARCHAR(1000) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_costs_product FOREIGN KEY (product_id) REFERENCES products(product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sales (
        sale_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sale_date DATE NOT NULL,
        order_no VARCHAR(100) NULL,
        product_id BIGINT UNSIGNED NOT NULL,
        quantity INT UNSIGNED NOT NULL,
        sale_price DECIMAL(15,2) NOT NULL DEFAULT 0,
        discount DECIMAL(15,2) NOT NULL DEFAULT 0,
        shipping_income DECIMAL(15,2) NOT NULL DEFAULT 0,
        shipping_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        packing_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
        platform_fee DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sales_product FOREIGN KEY (product_id) REFERENCES products(product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS adjustments (
        adjustment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        adjustment_date DATE NOT NULL,
        product_id BIGINT UNSIGNED NOT NULL,
        quantity_delta INT NOT NULL,
        reason VARCHAR(100) NOT NULL,
        memo VARCHAR(1000) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_adjustments_product FOREIGN KEY (product_id) REFERENCES products(product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing(conn, 'products', 'product_type', "VARCHAR(20) NOT NULL DEFAULT 'single'");
    await addColumnIfMissing(conn, 'products', 'category', 'VARCHAR(50) NULL');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS product_components (
        component_row_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        set_product_id BIGINT UNSIGNED NOT NULL,
        component_product_id BIGINT UNSIGNED NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        CONSTRAINT fk_pc_set FOREIGN KEY (set_product_id) REFERENCES products(product_id) ON DELETE CASCADE,
        CONSTRAINT fk_pc_component FOREIGN KEY (component_product_id) REFERENCES products(product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(
      'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_key = setting_key',
      ['defaultRate', 190],
    );
  } finally {
    if (conn) conn.release();
  }
}

async function readState(conn) {
  const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [], adjustments: [] };
  const settings = await conn.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', ['defaultRate']);
  if (settings.length) state.settings.defaultRate = number(settings[0].setting_value, 190);

  const products = await conn.query(`
    SELECT product_id, product_code, product_name, product_option, supplier, base_sale_price, reorder_level, product_type, category
    FROM products WHERE is_active = 1 ORDER BY product_id ASC
  `);
  const componentRows = await conn.query(
    'SELECT set_product_id, component_product_id, quantity FROM product_components ORDER BY component_row_id ASC',
  );
  const componentsBySet = {};
  componentRows.forEach((row) => {
    const key = String(row.set_product_id);
    (componentsBySet[key] = componentsBySet[key] || []).push({ productId: String(row.component_product_id), quantity: integer(row.quantity) || 1 });
  });
  state.products = products.map((row) => ({
    id: String(row.product_id), code: row.product_code, name: row.product_name,
    option: row.product_option || '', supplier: row.supplier || '',
    salePrice: number(row.base_sale_price), reorderLevel: integer(row.reorder_level),
    category: row.category || '',
    type: row.product_type === 'set' ? 'set' : 'single',
    components: componentsBySet[String(row.product_id)] || [],
  }));

  const purchases = await conn.query(`
    SELECT purchase_id, purchase_date AS date, product_id, supplier, quantity, currency, unit_price, exchange_rate, shipping_cost, memo
    FROM purchases ORDER BY purchase_id ASC
  `);
  state.purchases = purchases.map((row) => ({
    id: String(row.purchase_id), date: dateOnly(row.date), productId: String(row.product_id),
    supplier: row.supplier || '',
    quantity: integer(row.quantity), currency: row.currency, unitPrice: number(row.unit_price),
    exchangeRate: number(row.exchange_rate), shipping: number(row.shipping_cost), memo: row.memo || '',
  }));

  const costs = await conn.query(`
    SELECT cost_id, cost_date AS date, cost_name, category, amount, allocation_type, product_id, memo
    FROM costs ORDER BY cost_id ASC
  `);
  state.costs = costs.map((row) => ({
    id: String(row.cost_id), date: dateOnly(row.date), name: row.cost_name, category: row.category,
    amount: number(row.amount), allocation: row.allocation_type,
    productId: row.product_id === null ? '' : String(row.product_id), memo: row.memo || '',
  }));

  const sales = await conn.query(`
    SELECT sale_id, sale_date AS date, order_no, product_id, quantity, sale_price, discount,
           shipping_income, shipping_cost, packing_cost, platform_fee
    FROM sales ORDER BY sale_id ASC
  `);
  state.sales = sales.map((row) => ({
    id: String(row.sale_id), date: dateOnly(row.date), orderNo: row.order_no || '',
    productId: String(row.product_id), quantity: integer(row.quantity), salePrice: number(row.sale_price),
    discount: number(row.discount), shippingIncome: number(row.shipping_income),
    shippingCost: number(row.shipping_cost), packingCost: number(row.packing_cost),
    platformFee: number(row.platform_fee),
  }));

  const adjustments = await conn.query(`
    SELECT adjustment_id, adjustment_date AS date, product_id, quantity_delta, reason, memo
    FROM adjustments ORDER BY adjustment_id ASC
  `);
  state.adjustments = adjustments.map((row) => ({
    id: String(row.adjustment_id), date: dateOnly(row.date), productId: String(row.product_id),
    delta: integer(Math.abs(row.quantity_delta)) * (Number(row.quantity_delta) < 0 ? -1 : 1),
    direction: Number(row.quantity_delta) < 0 ? 'decrease' : 'increase',
    quantity: Math.abs(Number(row.quantity_delta) || 0), reason: row.reason || '', memo: row.memo || '',
  }));
  return state;
}

async function getActiveProduct(conn, productId) {
  const rows = await conn.query('SELECT product_id FROM products WHERE product_id = ? AND is_active = 1', [productId]);
  if (!rows.length) throw error('선택한 상품을 찾을 수 없습니다.', 404);
  return String(rows[0].product_id);
}

async function getProductType(conn, productId) {
  const rows = await conn.query('SELECT product_type FROM products WHERE product_id = ?', [productId]);
  return rows.length && rows[0].product_type === 'set' ? 'set' : 'single';
}

async function saveComponents(conn, setId, components) {
  await conn.query('DELETE FROM product_components WHERE set_product_id = ?', [setId]);
  const list = Array.isArray(components) ? components : [];
  let count = 0;
  for (const item of list) {
    const qty = integer(item?.quantity) || 1;
    if (qty < 1) continue;
    let compId;
    try { compId = await getActiveProduct(conn, item?.productId); } catch (_) { continue; }
    if (String(compId) === String(setId)) continue;
    if (await getProductType(conn, compId) === 'set') throw error('세트 안에 다른 세트를 넣을 수 없습니다. 단일 상품만 부품으로 선택해 주세요.');
    await conn.query('INSERT INTO product_components (set_product_id, component_product_id, quantity) VALUES (?, ?, ?)', [setId, compId, qty]);
    count += 1;
  }
  return count;
}

async function nextProductCode(conn) {
  const rows = await conn.query(`
    SELECT product_code FROM products
    WHERE product_code REGEXP '^CK-[0-9]+$'
    ORDER BY CAST(SUBSTRING(product_code, 4) AS UNSIGNED) DESC LIMIT 1
  `);
  const current = rows.length ? Number(String(rows[0].product_code).slice(3)) : 0;
  return `CK-${String(current + 1).padStart(3, '0')}`;
}

async function replyState(res, conn) {
  const state = await readState(conn);
  res.set('Cache-Control', 'no-store').json(state);
}

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('event: connected\ndata: ok\n\n');
  eventClients.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
});

app.get('/api/health', accessKey, async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.use('/api', accessKey);

app.get('/api/state', async (req, res, next) => {
  let conn;
  try { conn = await pool.getConnection(); await replyState(res, conn); }
  catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.patch('/api/settings', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const defaultRate = number(req.body?.defaultRate, 190);
    await conn.query(
      'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['defaultRate', defaultRate],
    );
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.post('/api/products', async (req, res, next) => {
  let conn;
  try {
    const name = text(req.body?.name, 200);
    if (!name) throw error('상품명을 입력해 주세요.');
    const isSet = req.body?.type === 'set';
    if (isSet && !(Array.isArray(req.body?.components) && req.body.components.length)) throw error('세트 상품은 부품을 1개 이상 지정해 주세요.');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const code = await nextProductCode(conn);
    const result = await conn.query(
      `INSERT INTO products (product_code, product_name, product_option, supplier, base_sale_price, reorder_level, product_type, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, text(req.body?.option, 200) || null, text(req.body?.supplier, 200) || null,
        number(req.body?.salePrice), integer(req.body?.reorderLevel), isSet ? 'set' : 'single', text(req.body?.category, 50) || null],
    );
    if (isSet) {
      const saved = await saveComponents(conn, String(result.insertId), req.body.components);
      if (!saved) throw error('세트 부품을 올바르게 지정해 주세요.');
    }
    await conn.commit();
    broadcast();
    await replyState(res, conn);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    next(err);
  } finally { if (conn) conn.release(); }
});

app.patch('/api/products/:id', async (req, res, next) => {
  let conn;
  try {
    const name = text(req.body?.name, 200);
    if (!name) throw error('상품명을 입력해 주세요.');
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const productId = await getActiveProduct(conn, req.params.id);
    await conn.query(
      `UPDATE products
       SET product_name = ?, product_option = ?, supplier = ?, base_sale_price = ?, reorder_level = ?, category = ?
       WHERE product_id = ?`,
      [name, text(req.body?.option, 200) || null, text(req.body?.supplier, 200) || null,
        number(req.body?.salePrice), integer(req.body?.reorderLevel), text(req.body?.category, 50) || null, productId],
    );
    if (req.body?.type !== undefined) {
      const isSet = req.body.type === 'set';
      await conn.query('UPDATE products SET product_type = ? WHERE product_id = ?', [isSet ? 'set' : 'single', productId]);
      if (isSet) {
        if (!(Array.isArray(req.body?.components) && req.body.components.length)) throw error('세트 상품은 부품을 1개 이상 지정해 주세요.');
        const saved = await saveComponents(conn, productId, req.body.components);
        if (!saved) throw error('세트 부품을 올바르게 지정해 주세요.');
      } else {
        await conn.query('DELETE FROM product_components WHERE set_product_id = ?', [productId]);
      }
    }
    await conn.commit();
    broadcast();
    await replyState(res, conn);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    next(err);
  } finally { if (conn) conn.release(); }
});

app.delete('/api/products/:id', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const productId = await getActiveProduct(conn, req.params.id);
    const related = await conn.query(`
      SELECT
        (SELECT COUNT(*) FROM purchases WHERE product_id = ?) +
        (SELECT COUNT(*) FROM costs WHERE product_id = ?) +
        (SELECT COUNT(*) FROM sales WHERE product_id = ?) AS count
    `, [productId, productId, productId]);
    if (Number(related[0].count) > 0) throw error('입고·비용·판매 기록이 있는 상품은 삭제할 수 없습니다.', 409);
    const usedInSet = await conn.query('SELECT COUNT(*) AS count FROM product_components WHERE component_product_id = ?', [productId]);
    if (Number(usedInSet[0].count) > 0) throw error('세트 완제품의 부품으로 사용 중인 상품입니다. 먼저 세트 구성에서 제외해 주세요.', 409);
    await conn.query('DELETE FROM products WHERE product_id = ?', [productId]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.post('/api/products/bulk', async (req, res, next) => {
  let conn;
  try {
    const cols = { salePrice: 'base_sale_price', reorderLevel: 'reorder_level', supplier: 'supplier', category: 'category' };
    const field = req.body?.field;
    if (!cols[field]) throw error('일괄 수정할 항목이 올바르지 않습니다.');
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite);
    if (!ids.length) throw error('수정할 상품을 선택해 주세요.');
    let value;
    if (field === 'salePrice') value = number(req.body?.value);
    else if (field === 'reorderLevel') value = integer(req.body?.value);
    else value = text(req.body?.value, field === 'category' ? 50 : 200) || null;
    conn = await pool.getConnection();
    const placeholders = ids.map(() => '?').join(',');
    await conn.query(`UPDATE products SET ${cols[field]} = ? WHERE product_id IN (${placeholders}) AND is_active = 1`, [value, ...ids]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.post('/api/products/:id/merge', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const sourceId = await getActiveProduct(conn, req.params.id);
    const targetId = await getActiveProduct(conn, req.body?.targetId);
    if (sourceId === targetId) throw error('같은 상품끼리는 합칠 수 없습니다.');
    if (await getProductType(conn, sourceId) === 'set' || await getProductType(conn, targetId) === 'set') {
      throw error('세트(완제품)는 합치기를 지원하지 않습니다. 단일 상품끼리만 합칠 수 있습니다.');
    }
    await conn.query('UPDATE purchases SET product_id = ? WHERE product_id = ?', [targetId, sourceId]);
    await conn.query('UPDATE sales SET product_id = ? WHERE product_id = ?', [targetId, sourceId]);
    await conn.query('UPDATE costs SET product_id = ? WHERE product_id = ?', [targetId, sourceId]);
    await conn.query('UPDATE adjustments SET product_id = ? WHERE product_id = ?', [targetId, sourceId]);
    await conn.query('UPDATE product_components SET component_product_id = ? WHERE component_product_id = ?', [targetId, sourceId]);
    await conn.query('DELETE FROM product_components WHERE set_product_id = ?', [sourceId]);
    await conn.query('DELETE FROM products WHERE product_id = ?', [sourceId]);
    await conn.commit();
    broadcast();
    await replyState(res, conn);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    next(err);
  } finally { if (conn) conn.release(); }
});

app.post('/api/purchases', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    if (!date) throw error('입고 날짜를 확인해 주세요.');
    if (integer(req.body?.quantity) < 1) throw error('입고 수량은 1개 이상이어야 합니다.');
    conn = await pool.getConnection();
    const productId = await getActiveProduct(conn, req.body?.productId);
    const currency = req.body?.currency === 'KRW' ? 'KRW' : 'CNY';
    await conn.query(
      `INSERT INTO purchases (purchase_date, product_id, supplier, quantity, currency, unit_price, exchange_rate, shipping_cost, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, productId, text(req.body?.supplier, 200) || null, integer(req.body?.quantity), currency, number(req.body?.unitPrice),
        currency === 'KRW' ? 1 : number(req.body?.exchangeRate, 190), number(req.body?.shipping), text(req.body?.memo) || null],
    );
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.patch('/api/purchases/:id', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    if (!date) throw error('입고 날짜를 확인해 주세요.');
    if (integer(req.body?.quantity) < 1) throw error('입고 수량은 1개 이상이어야 합니다.');
    conn = await pool.getConnection();
    const productId = await getActiveProduct(conn, req.body?.productId);
    const currency = req.body?.currency === 'KRW' ? 'KRW' : 'CNY';
    const result = await conn.query(
      `UPDATE purchases
       SET purchase_date = ?, product_id = ?, supplier = ?, quantity = ?, currency = ?, unit_price = ?, exchange_rate = ?, shipping_cost = ?, memo = ?
       WHERE purchase_id = ?`,
      [date, productId, text(req.body?.supplier, 200) || null, integer(req.body?.quantity), currency, number(req.body?.unitPrice),
        currency === 'KRW' ? 1 : number(req.body?.exchangeRate, 190), number(req.body?.shipping), text(req.body?.memo) || null, req.params.id],
    );
    if (Number(result.affectedRows) === 0) throw error('수정할 입고 기록을 찾을 수 없습니다.', 404);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.delete('/api/purchases/:id', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM purchases WHERE purchase_id = ?', [req.params.id]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.post('/api/costs', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    const name = text(req.body?.name, 200);
    if (!date || !name) throw error('비용 날짜와 비용명을 확인해 주세요.');
    const allocation = ['allQty', 'allValue', 'product', 'business'].includes(req.body?.allocation)
      ? req.body.allocation : 'business';
    conn = await pool.getConnection();
    const productId = allocation === 'product' ? await getActiveProduct(conn, req.body?.productId) : null;
    await conn.query(
      `INSERT INTO costs (cost_date, cost_name, category, amount, allocation_type, product_id, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [date, name, text(req.body?.category, 100) || '기타', number(req.body?.amount), allocation, productId, text(req.body?.memo) || null],
    );
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.patch('/api/costs/:id', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    const name = text(req.body?.name, 200);
    if (!date || !name) throw error('비용 날짜와 비용명을 확인해 주세요.');
    const allocation = ['allQty', 'allValue', 'product', 'business'].includes(req.body?.allocation)
      ? req.body.allocation : 'business';
    conn = await pool.getConnection();
    const productId = allocation === 'product' ? await getActiveProduct(conn, req.body?.productId) : null;
    const result = await conn.query(
      `UPDATE costs
       SET cost_date = ?, cost_name = ?, category = ?, amount = ?, allocation_type = ?, product_id = ?, memo = ?
       WHERE cost_id = ?`,
      [date, name, text(req.body?.category, 100) || '기타', number(req.body?.amount), allocation, productId, text(req.body?.memo) || null, req.params.id],
    );
    if (Number(result.affectedRows) === 0) throw error('수정할 비용 기록을 찾을 수 없습니다.', 404);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.delete('/api/costs/:id', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM costs WHERE cost_id = ?', [req.params.id]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.post('/api/sales', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    if (!date) throw error('판매 날짜를 확인해 주세요.');
    if (integer(req.body?.quantity) < 1) throw error('판매 수량은 1개 이상이어야 합니다.');
    conn = await pool.getConnection();
    const productId = await getActiveProduct(conn, req.body?.productId);
    await conn.query(
      `INSERT INTO sales (sale_date, order_no, product_id, quantity, sale_price, discount, shipping_income, shipping_cost, packing_cost, platform_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, text(req.body?.orderNo, 100) || null, productId, integer(req.body?.quantity), number(req.body?.salePrice),
       number(req.body?.discount), number(req.body?.shippingIncome), number(req.body?.shippingCost), number(req.body?.packingCost), number(req.body?.platformFee)],
    );
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.patch('/api/sales/:id', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    if (!date) throw error('판매 날짜를 확인해 주세요.');
    if (integer(req.body?.quantity) < 1) throw error('판매 수량은 1개 이상이어야 합니다.');
    conn = await pool.getConnection();
    const productId = await getActiveProduct(conn, req.body?.productId);
    const result = await conn.query(
      `UPDATE sales
       SET sale_date = ?, order_no = ?, product_id = ?, quantity = ?, sale_price = ?, discount = ?,
           shipping_income = ?, shipping_cost = ?, packing_cost = ?, platform_fee = ?
       WHERE sale_id = ?`,
      [date, text(req.body?.orderNo, 100) || null, productId, integer(req.body?.quantity), number(req.body?.salePrice),
       number(req.body?.discount), number(req.body?.shippingIncome), number(req.body?.shippingCost),
       number(req.body?.packingCost), number(req.body?.platformFee), req.params.id],
    );
    if (Number(result.affectedRows) === 0) throw error('수정할 판매 기록을 찾을 수 없습니다.', 404);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.delete('/api/sales/:id', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM sales WHERE sale_id = ?', [req.params.id]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.post('/api/adjustments', async (req, res, next) => {
  let conn;
  try {
    const date = dateOnly(req.body?.date);
    if (!date) throw error('조정 날짜를 확인해 주세요.');
    const quantity = integer(req.body?.quantity);
    if (quantity < 1) throw error('조정 수량은 1개 이상이어야 합니다.');
    const reason = text(req.body?.reason, 100);
    if (!reason) throw error('조정 사유를 선택해 주세요.');
    const delta = req.body?.direction === 'increase' ? quantity : -quantity;
    conn = await pool.getConnection();
    const productId = await getActiveProduct(conn, req.body?.productId);
    await conn.query(
      'INSERT INTO adjustments (adjustment_date, product_id, quantity_delta, reason, memo) VALUES (?, ?, ?, ?, ?)',
      [date, productId, delta, reason, text(req.body?.memo) || null],
    );
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.delete('/api/adjustments/:id', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM adjustments WHERE adjustment_id = ?', [req.params.id]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
});

app.put('/api/import', async (req, res, next) => {
  let conn;
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const products = Array.isArray(incoming.products) ? incoming.products : [];
    const purchases = Array.isArray(incoming.purchases) ? incoming.purchases : [];
    const costs = Array.isArray(incoming.costs) ? incoming.costs : [];
    const sales = Array.isArray(incoming.sales) ? incoming.sales : [];
    const adjustments = Array.isArray(incoming.adjustments) ? incoming.adjustments : [];
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('DELETE FROM product_components');
    await conn.query('DELETE FROM adjustments');
    await conn.query('DELETE FROM sales');
    await conn.query('DELETE FROM purchases');
    await conn.query('DELETE FROM costs');
    await conn.query('DELETE FROM products');
    await conn.query('DELETE FROM app_settings');
    await conn.query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', ['defaultRate', number(incoming.settings?.defaultRate, 190)]);
    const idMap = new Map();
    for (const product of products) {
      const name = text(product.name, 200);
      if (!name) throw error('가져오기 파일에 상품명이 비어 있는 항목이 있습니다.');
      const code = text(product.code, 30) || await nextProductCode(conn);
      const result = await conn.query(
        `INSERT INTO products (product_code, product_name, product_option, supplier, base_sale_price, reorder_level, product_type, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, name, text(product.option, 200) || null, text(product.supplier, 200) || null, number(product.salePrice), integer(product.reorderLevel), product.type === 'set' ? 'set' : 'single', text(product.category, 50) || null],
      );
      idMap.set(String(product.id), String(result.insertId));
    }
    for (const product of products) {
      if (product.type !== 'set') continue;
      const setId = idMap.get(String(product.id));
      if (!setId) continue;
      for (const comp of (Array.isArray(product.components) ? product.components : [])) {
        const compId = idMap.get(String(comp.productId));
        const qty = integer(comp.quantity) || 1;
        if (!compId || qty < 1) continue;
        await conn.query('INSERT INTO product_components (set_product_id, component_product_id, quantity) VALUES (?, ?, ?)', [setId, compId, qty]);
      }
    }
    const resolveProduct = (id) => {
      const mapped = idMap.get(String(id));
      if (!mapped) throw error('가져오기 파일에 존재하지 않는 상품을 참조하는 기록이 있습니다.');
      return mapped;
    };
    for (const item of purchases) {
      const date = dateOnly(item.date); if (!date) throw error('가져오기 파일의 입고 날짜를 확인해 주세요.');
      const currency = item.currency === 'KRW' ? 'KRW' : 'CNY';
      await conn.query(`INSERT INTO purchases (purchase_date, product_id, supplier, quantity, currency, unit_price, exchange_rate, shipping_cost, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [date, resolveProduct(item.productId), text(item.supplier, 200) || null, integer(item.quantity), currency, number(item.unitPrice), currency === 'KRW' ? 1 : number(item.exchangeRate, 190), number(item.shipping), text(item.memo) || null]);
    }
    for (const item of costs) {
      const date = dateOnly(item.date); if (!date || !text(item.name, 200)) throw error('가져오기 파일의 비용 정보를 확인해 주세요.');
      const allocation = ['allQty', 'allValue', 'product', 'business'].includes(item.allocation) ? item.allocation : 'business';
      await conn.query(`INSERT INTO costs (cost_date, cost_name, category, amount, allocation_type, product_id, memo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [date, text(item.name, 200), text(item.category, 100) || '기타', number(item.amount), allocation, allocation === 'product' ? resolveProduct(item.productId) : null, text(item.memo) || null]);
    }
    for (const item of sales) {
      const date = dateOnly(item.date); if (!date) throw error('가져오기 파일의 판매 날짜를 확인해 주세요.');
      await conn.query(`INSERT INTO sales (sale_date, order_no, product_id, quantity, sale_price, discount, shipping_income, shipping_cost, packing_cost, platform_fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [date, text(item.orderNo, 100) || null, resolveProduct(item.productId), integer(item.quantity), number(item.salePrice), number(item.discount), number(item.shippingIncome), number(item.shippingCost), number(item.packingCost), number(item.platformFee)]);
    }
    for (const item of adjustments) {
      const date = dateOnly(item.date); if (!date) throw error('가져오기 파일의 재고 조정 날짜를 확인해 주세요.');
      const qty = integer(item.quantity ?? Math.abs(item.delta));
      if (qty < 1) continue;
      const delta = (item.direction === 'increase' || Number(item.delta) > 0) ? qty : -qty;
      await conn.query('INSERT INTO adjustments (adjustment_date, product_id, quantity_delta, reason, memo) VALUES (?, ?, ?, ?, ?)',
        [date, resolveProduct(item.productId), delta, text(item.reason, 100) || '조정', text(item.memo) || null]);
    }
    await conn.commit();
    broadcast();
    await replyState(res, conn);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    next(err);
  } finally { if (conn) conn.release(); }
});

/* ── 시세조사 동기화 API ─────────────────────────────────────────────── */
const SURVEY_MAX_PAYLOAD = 256 * 1024;   // 기록 한 건 상한
const SURVEY_MAX_BATCH = 500;

// 마지막으로 받아간 시각 이후에 바뀐 것만 내려준다(지운 것 포함).
app.get('/api/survey/changes', async (req, res, next) => {
  let conn;
  try {
    const since = Number.isFinite(Number(req.query.since)) ? Math.max(0, Number(req.query.since)) : 0;
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

// 기기에서 바뀐 것을 올린다. 같은 uid 는 updated_at 이 큰 쪽만 남는다.
app.post('/api/survey/push', async (req, res, next) => {
  let conn;
  try {
    const list = Array.isArray(req.body?.records) ? req.body.records : [];
    if (list.length > SURVEY_MAX_BATCH) {
      const err = new Error(`한 번에 ${SURVEY_MAX_BATCH}건까지 보낼 수 있습니다.`);
      err.status = 400;
      throw err;
    }
    conn = await pool.getConnection();
    let applied = 0;
    for (const item of list) {
      const uid = text(item?.uid, 64);
      if (!uid) continue;
      const updatedAt = integer(item?.updatedAt, 0) || Date.now();
      const deleted = item?.deleted ? 1 : 0;
      const payload = deleted ? null : JSON.stringify(item?.rec ?? null);
      if (payload && payload.length > SURVEY_MAX_PAYLOAD) continue;   // 너무 큰 건은 건너뛴다
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
  const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500);
  const message = err.status ? err.message : '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  res.status(status).json({ message });
});

async function start() {
  await ensureSchema();
  {
    const conn = await pool.getConnection();
    try { await ensureSurveySchema(conn); } finally { conn.release(); }
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Kokring server listening on ${PORT}`));
}
start().catch((err) => { console.error('Server startup failed:', err); process.exit(1); });
