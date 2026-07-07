require('dotenv').config();

const path = require('path');
const express = require('express');
const mariadb = require('mariadb');

const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'APP_ACCESS_KEY'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const app = express();
const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 6,
  dateStrings: true,
  acquireTimeout: 10000,
});

const eventClients = new Set();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname, { index: 'index.html' }));

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
    await conn.query(
      'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_key = setting_key',
      ['defaultRate', 190],
    );
  } finally {
    if (conn) conn.release();
  }
}

async function readState(conn) {
  const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [] };
  const settings = await conn.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', ['defaultRate']);
  if (settings.length) state.settings.defaultRate = number(settings[0].setting_value, 190);

  const products = await conn.query(`
    SELECT product_id, product_code, product_name, product_option, supplier, base_sale_price, reorder_level
    FROM products WHERE is_active = 1 ORDER BY product_id ASC
  `);
  state.products = products.map((row) => ({
    id: String(row.product_id), code: row.product_code, name: row.product_name,
    option: row.product_option || '', supplier: row.supplier || '',
    salePrice: number(row.base_sale_price), reorderLevel: integer(row.reorder_level),
  }));

  const purchases = await conn.query(`
    SELECT purchase_id, purchase_date AS date, product_id, quantity, currency, unit_price, exchange_rate, shipping_cost, memo
    FROM purchases ORDER BY purchase_id ASC
  `);
  state.purchases = purchases.map((row) => ({
    id: String(row.purchase_id), date: dateOnly(row.date), productId: String(row.product_id),
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
  return state;
}

async function getActiveProduct(conn, productId) {
  const rows = await conn.query('SELECT product_id FROM products WHERE product_id = ? AND is_active = 1', [productId]);
  if (!rows.length) throw error('선택한 상품을 찾을 수 없습니다.', 404);
  return String(rows[0].product_id);
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
    conn = await pool.getConnection();
    const code = await nextProductCode(conn);
    await conn.query(
      `INSERT INTO products (product_code, product_name, product_option, supplier, base_sale_price, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, name, text(req.body?.option, 200) || null, text(req.body?.supplier, 200) || null,
        number(req.body?.salePrice), integer(req.body?.reorderLevel)],
    );
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
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
    await conn.query('DELETE FROM products WHERE product_id = ?', [productId]);
    broadcast();
    await replyState(res, conn);
  } catch (err) { next(err); } finally { if (conn) conn.release(); }
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
      `INSERT INTO purchases (purchase_date, product_id, quantity, currency, unit_price, exchange_rate, shipping_cost, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, productId, integer(req.body?.quantity), currency, number(req.body?.unitPrice),
        currency === 'KRW' ? 1 : number(req.body?.exchangeRate, 190), number(req.body?.shipping), text(req.body?.memo) || null],
    );
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

app.delete('/api/sales/:id', async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM sales WHERE sale_id = ?', [req.params.id]);
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
    conn = await pool.getConnection();
    await conn.beginTransaction();
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
        `INSERT INTO products (product_code, product_name, product_option, supplier, base_sale_price, reorder_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [code, name, text(product.option, 200) || null, text(product.supplier, 200) || null, number(product.salePrice), integer(product.reorderLevel)],
      );
      idMap.set(String(product.id), String(result.insertId));
    }
    const resolveProduct = (id) => {
      const mapped = idMap.get(String(id));
      if (!mapped) throw error('가져오기 파일에 존재하지 않는 상품을 참조하는 기록이 있습니다.');
      return mapped;
    };
    for (const item of purchases) {
      const date = dateOnly(item.date); if (!date) throw error('가져오기 파일의 입고 날짜를 확인해 주세요.');
      const currency = item.currency === 'KRW' ? 'KRW' : 'CNY';
      await conn.query(`INSERT INTO purchases (purchase_date, product_id, quantity, currency, unit_price, exchange_rate, shipping_cost, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [date, resolveProduct(item.productId), integer(item.quantity), currency, number(item.unitPrice), currency === 'KRW' ? 1 : number(item.exchangeRate, 190), number(item.shipping), text(item.memo) || null]);
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
    await conn.commit();
    broadcast();
    await replyState(res, conn);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    next(err);
  } finally { if (conn) conn.release(); }
});

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500);
  const message = err.status ? err.message : '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  res.status(status).json({ message });
});

async function start() {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => console.log(`Kokring server listening on ${PORT}`));
}
start().catch((err) => { console.error('Server startup failed:', err); process.exit(1); });
