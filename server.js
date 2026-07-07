require("dotenv").config();

const path = require("path");
const express = require("express");
const mariadb = require("mariadb");

const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "APP_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`.env ?뚯씪???ㅼ쓬 媛믪씠 鍮꾩뼱 ?덉뒿?덈떎: ${missing.join(", ")}`);
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
  connectionLimit: 5,
  dateStrings: true
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname, { index: "index.html" }));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.max(0, Math.trunc(number(value, fallback)));
}

function text(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function emptyState() {
  return {
    settings: { defaultRate: 190 },
    products: [],
    purchases: [],
    costs: [],
    sales: []
  };
}

function normaliseState(body) {
  const source = body && typeof body === "object" ? body : {};
  return {
    settings: {
      defaultRate: number(source.settings?.defaultRate, 190)
    },
    products: Array.isArray(source.products) ? source.products : [],
    purchases: Array.isArray(source.purchases) ? source.purchases : [],
    costs: Array.isArray(source.costs) ? source.costs : [],
    sales: Array.isArray(source.sales) ? source.sales : []
  };
}

function assertValidState(state) {
  const codes = new Set();

  for (const product of state.products) {
    const code = text(product.code, 30);
    const name = text(product.name, 200);

    if (!code || !name) {
      throw new Error("?곹뭹 肄붾뱶? ?곹뭹紐낆? 諛섎뱶???낅젰?댁빞 ?⑸땲??");
    }
    if (codes.has(code)) {
      throw new Error(`?곹뭹 肄붾뱶媛 以묐났?섏뿀?듬땲?? ${code}`);
    }
    codes.add(code);
  }

  for (const purchase of state.purchases) {
    if (!dateOnly(purchase.date) || !String(purchase.productId || "")) {
      throw new Error("?낃퀬 ?좎쭨? ?곹뭹???뺤씤?섏꽭??");
    }
    if (integer(purchase.quantity) < 1) {
      throw new Error("?낃퀬 ?섎웾? 1媛??댁긽?댁뼱???⑸땲??");
    }
  }

  for (const cost of state.costs) {
    if (!dateOnly(cost.date) || !text(cost.name, 200)) {
      throw new Error("鍮꾩슜 ?좎쭨? 鍮꾩슜紐낆쓣 ?뺤씤?섏꽭??");
    }
  }

  for (const sale of state.sales) {
    if (!dateOnly(sale.date) || !String(sale.productId || "")) {
      throw new Error("?먮ℓ ?좎쭨? ?곹뭹???뺤씤?섏꽭??");
    }
    if (integer(sale.quantity) < 1) {
      throw new Error("?먮ℓ ?섎웾? 1媛??댁긽?댁뼱???⑸땲??");
    }
  }
}

function apiAccessKey(req, res, next) {
  const key = req.get("x-kokring-access-key");
  if (key !== process.env.APP_ACCESS_KEY) {
    return res.status(401).json({ message: "?ш퀬愿由??묒냽 鍮꾨?踰덊샇媛 留욎? ?딆뒿?덈떎." });
  }
  next();
}

app.use("/api", apiAccessKey);

async function readState(conn) {
  const state = emptyState();

  const settingRows = await conn.query(
    "SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ?",
    ["defaultRate"]
  );
  if (settingRows.length) {
    state.settings.defaultRate = number(settingRows[0].setting_value, 190);
  }

  const productRows = await conn.query(`
    SELECT product_id, product_code, product_name, product_option, supplier,
           base_sale_price, reorder_level
    FROM products
    WHERE is_active = 1
    ORDER BY product_id ASC
  `);
  state.products = productRows.map((row) => ({
    id: String(row.product_id),
    code: row.product_code,
    name: row.product_name,
    option: row.product_option || "",
    supplier: row.supplier || "",
    salePrice: number(row.base_sale_price),
    reorderLevel: integer(row.reorder_level)
  }));

  const purchaseRows = await conn.query(`
    SELECT purchase_id, purchase_date AS date, product_id, quantity, currency,
           unit_price, exchange_rate, shipping_cost, memo
    FROM purchases
    ORDER BY purchase_id ASC
  `);
  state.purchases = purchaseRows.map((row) => ({
    id: String(row.purchase_id),
    date: dateOnly(row.date),
    productId: String(row.product_id),
    quantity: integer(row.quantity),
    currency: row.currency,
    unitPrice: number(row.unit_price),
    exchangeRate: number(row.exchange_rate),
    shipping: number(row.shipping_cost),
    memo: row.memo || ""
  }));

  const costRows = await conn.query(`
    SELECT cost_id, cost_date, cost_name, category, amount,
           allocation_type, product_id, memo
    FROM costs
    ORDER BY cost_id ASC
  `);
  state.costs = costRows.map((row) => ({
    id: String(row.cost_id),
    date: dateOnly(row.cost_date),
    name: row.cost_name,
    category: row.category,
    amount: number(row.amount),
    allocation: row.allocation_type,
    productId: row.product_id === null ? "" : String(row.product_id),
    memo: row.memo || ""
  }));

  const saleRows = await conn.query(`
    SELECT sale_id, sale_date AS date, order_no, product_id, quantity, sale_price,
           discount, shipping_income, shipping_cost, packing_cost, platform_fee
    FROM sales
    ORDER BY sale_id ASC
  `);
  state.sales = saleRows.map((row) => ({
    id: String(row.sale_id),
    date: dateOnly(row.date),
    orderNo: row.order_no || "",
    productId: String(row.product_id),
    quantity: integer(row.quantity),
    salePrice: number(row.sale_price),
    discount: number(row.discount),
    shippingIncome: number(row.shipping_income),
    shippingCost: number(row.shipping_cost),
    packingCost: number(row.packing_cost),
    platformFee: number(row.platform_fee)
  }));

  return state;
}

async function writeState(conn, state) {
  assertValidState(state);

  await conn.query("DELETE FROM sales");
  await conn.query("DELETE FROM purchases");
  await conn.query("DELETE FROM costs");
  await conn.query("DELETE FROM products");
  await conn.query("DELETE FROM app_settings");

  await conn.query(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)",
    ["defaultRate", number(state.settings.defaultRate, 190)]
  );

  const productIdMap = new Map();

  for (const product of state.products) {
    const result = await conn.query(
      `INSERT INTO products
       (product_code, product_name, product_option, supplier, base_sale_price, reorder_level, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [
        text(product.code, 30),
        text(product.name, 200),
        text(product.option, 200) || null,
        text(product.supplier, 200) || null,
        number(product.salePrice),
        integer(product.reorderLevel)
      ]
    );
    productIdMap.set(String(product.id), String(result.insertId));
  }

  const requireProductId = (clientProductId) => {
    const dbProductId = productIdMap.get(String(clientProductId));
    if (!dbProductId) {
      throw new Error("??젣???곹뭹??李몄“?섎뒗 ?낃퀬쨌鍮꾩슜쨌?먮ℓ 湲곕줉???덉뒿?덈떎. ?대떦 湲곕줉???④퍡 ??젣?섏꽭??");
    }
    return dbProductId;
  };

  for (const purchase of state.purchases) {
    await conn.query(
      `INSERT INTO purchases
       (purchase_date, product_id, quantity, currency, unit_price, exchange_rate, shipping_cost, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dateOnly(purchase.date),
        requireProductId(purchase.productId),
        integer(purchase.quantity),
        purchase.currency === "KRW" ? "KRW" : "CNY",
        number(purchase.unitPrice),
        purchase.currency === "KRW" ? 1 : number(purchase.exchangeRate, state.settings.defaultRate),
        number(purchase.shipping),
        text(purchase.memo, 1000) || null
      ]
    );
  }

  for (const cost of state.costs) {
    const allocation = ["allQty", "allValue", "product", "business"].includes(cost.allocation)
      ? cost.allocation
      : "business";

    await conn.query(
      `INSERT INTO costs
       (cost_date, cost_name, category, amount, allocation_type, product_id, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        dateOnly(cost.date),
        text(cost.name, 200),
        text(cost.category, 100) || "湲고?",
        number(cost.amount),
        allocation,
        allocation === "product" ? requireProductId(cost.productId) : null,
        text(cost.memo, 1000) || null
      ]
    );
  }

  for (const sale of state.sales) {
    await conn.query(
      `INSERT INTO sales
       (sale_date, order_no, product_id, quantity, sale_price, discount,
        shipping_income, shipping_cost, packing_cost, platform_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dateOnly(sale.date),
        text(sale.orderNo, 100) || null,
        requireProductId(sale.productId),
        integer(sale.quantity),
        number(sale.salePrice),
        number(sale.discount),
        number(sale.shippingIncome),
        number(sale.shippingCost),
        number(sale.packingCost),
        number(sale.platformFee)
      ]
    );
  }
}

app.get("/api/health", async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("SELECT 1");
    res.set("Cache-Control", "no-store");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  } finally {
    if (conn) conn.release();
  }
});

app.get("/api/state", async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const state = await readState(conn);
    res.set("Cache-Control", "no-store");
    res.json(state);
  } catch (error) {
    next(error);
  } finally {
    if (conn) conn.release();
  }
});

app.put("/api/state", async (req, res, next) => {
  let conn;
  try {
    const incoming = normaliseState(req.body);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await writeState(conn, incoming);
    await conn.commit();

    const freshState = await readState(conn);
    res.set("Cache-Control", "no-store");
    res.json(freshState);
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {
        // rollback ?ㅽ뙣???먮옒 ?ㅻ쪟瑜??곗꽑 ?쒖떆?⑸땲??
      }
    }
    next(error);
  } finally {
    if (conn) conn.release();
  }
});

app.use((error, req, res, next) => {
  console.error("?쒕쾭 ?ㅻ쪟:", error);
  const message = error?.message || "?쒕쾭?먯꽌 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.";
  res.status(500).json({ message });
});

async function start() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("SELECT 1");
  } finally {
    if (conn) conn.release();
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("??肄뺣쭅 ?ш퀬愿由??쒕쾭媛 ?ㅽ뻾?섏뿀?듬땲??");
    console.log(`PC ?묒냽: http://localhost:${PORT}`);
    console.log(`?대????묒냽: 媛숈? ??댄뙆?댁뿉??PC??IPv4 二쇱냼:${PORT}`);
    console.log("");
  });
}

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

start().catch((error) => {
  console.error("???쒕쾭 ?쒖옉 ?ㅽ뙣:", error.message);
  process.exit(1);
});


