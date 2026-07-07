const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [] };
const formatter = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
const ACCESS_KEY_STORAGE = "kokring_inventory_access_key";

let lastSyncedState = null;
let syncing = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return formatter.format(Math.round(Number(value) || 0));
}

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(Number(value) || 0));
}

function toNum(value) {
  return Number(value) || 0;
}

function formatDate(value) {
  if (!value) return "-";
  return dateFormatter.format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function replaceState(nextState) {
  state.settings = nextState.settings || { defaultRate: 190 };
  state.products = Array.isArray(nextState.products) ? nextState.products : [];
  state.purchases = Array.isArray(nextState.purchases) ? nextState.purchases : [];
  state.costs = Array.isArray(nextState.costs) ? nextState.costs : [];
  state.sales = Array.isArray(nextState.sales) ? nextState.sales : [];
  lastSyncedState = clone(state);
}

function accessKey() {
  let key = localStorage.getItem(ACCESS_KEY_STORAGE);
  if (!key) {
    key = prompt("재고관리 접속 비밀번호를 입력하세요.\nPC의 .env 파일 APP_ACCESS_KEY와 같은 값입니다.");
    if (!key) throw new Error("접속 비밀번호 입력이 취소되었습니다.");
    localStorage.setItem(ACCESS_KEY_STORAGE, key.trim());
  }
  return key.trim();
}

async function api(path, options = {}, retried = false) {
  const headers = {
    "x-kokring-access-key": accessKey(),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(path, { ...options, headers });
  let body = null;

  try {
    body = await response.json();
  } catch (_) {
    // JSON 오류는 아래 상태 코드로 처리합니다.
  }

  if (response.status === 401 && !retried) {
    localStorage.removeItem(ACCESS_KEY_STORAGE);
    return api(path, options, true);
  }

  if (!response.ok) {
    throw new Error(body?.message || `서버 오류 (${response.status})`);
  }

  return body;
}

function setSyncStatus(message, type = "") {
  const target = $("#syncStatus");
  if (!target) return;
  target.textContent = message;
  target.className = `sync-status ${type}`;
}

function productName(productId) {
  const product = state.products.find((item) => String(item.id) === String(productId));
  if (!product) return "삭제된 상품";
  return product.option ? `${product.name} / ${product.option}` : product.name;
}

function purchaseTotal(purchase) {
  const itemTotal = purchase.currency === "CNY"
    ? purchase.quantity * purchase.unitPrice * purchase.exchangeRate
    : purchase.quantity * purchase.unitPrice;
  return itemTotal + toNum(purchase.shipping);
}

function allocatedCostsByProduct() {
  const map = Object.fromEntries(state.products.map((product) => [product.id, 0]));
  const productQty = {};
  const productValue = {};

  state.purchases.forEach((purchase) => {
    productQty[purchase.productId] = (productQty[purchase.productId] || 0) + purchase.quantity;
    productValue[purchase.productId] = (productValue[purchase.productId] || 0) + purchaseTotal(purchase);
  });

  const totalQty = Object.values(productQty).reduce((sum, value) => sum + value, 0);
  const totalValue = Object.values(productValue).reduce((sum, value) => sum + value, 0);

  state.costs.forEach((cost) => {
    if (cost.allocation === "business") return;

    if (cost.allocation === "product" && map[cost.productId] !== undefined) {
      map[cost.productId] += cost.amount;
      return;
    }

    state.products.forEach((product) => {
      if (cost.allocation === "allQty" && totalQty > 0) {
        map[product.id] += cost.amount * ((productQty[product.id] || 0) / totalQty);
      }
      if (cost.allocation === "allValue" && totalValue > 0) {
        map[product.id] += cost.amount * ((productValue[product.id] || 0) / totalValue);
      }
    });
  });

  return map;
}

function inventoryStats() {
  const allocated = allocatedCostsByProduct();

  return state.products.map((product) => {
    const purchases = state.purchases.filter((item) => String(item.productId) === String(product.id));
    const sales = state.sales.filter((item) => String(item.productId) === String(product.id));

    const purchasedQty = purchases.reduce((sum, item) => sum + item.quantity, 0);
    const soldQty = sales.reduce((sum, item) => sum + item.quantity, 0);
    const purchaseValue = purchases.reduce((sum, item) => sum + purchaseTotal(item), 0);
    const totalCost = purchaseValue + (allocated[product.id] || 0);
    const avgCost = purchasedQty > 0 ? totalCost / purchasedQty : 0;
    const stock = purchasedQty - soldQty;
    const salePrice = toNum(product.salePrice);
    const margin = salePrice - avgCost;
    const marginRate = salePrice > 0 ? margin / salePrice : 0;

    return {
      product,
      purchasedQty,
      soldQty,
      stock,
      avgCost,
      salePrice,
      margin,
      marginRate,
      inventoryValue: Math.max(stock, 0) * avgCost
    };
  });
}

function saleResult(sale, statsMap) {
  const stat = statsMap[sale.productId] || { avgCost: 0 };
  const grossSales = sale.quantity * sale.salePrice;
  const netRevenue = grossSales - sale.discount + sale.shippingIncome;
  const cogs = sale.quantity * stat.avgCost;
  const expense = sale.shippingCost + sale.packingCost + sale.platformFee;

  return {
    grossSales,
    netRevenue,
    cogs,
    expense,
    profit: netRevenue - cogs - expense
  };
}

function totals() {
  const stats = inventoryStats();
  const statsMap = Object.fromEntries(stats.map((item) => [item.product.id, item]));

  return {
    stats,
    statsMap,
    investment: state.purchases.reduce((sum, item) => sum + purchaseTotal(item), 0)
      + state.costs.reduce((sum, item) => sum + item.amount, 0),
    revenue: state.sales.reduce((sum, sale) => sum + saleResult(sale, statsMap).netRevenue, 0),
    profit: state.sales.reduce((sum, sale) => sum + saleResult(sale, statsMap).profit, 0),
    inventoryValue: stats.reduce((sum, item) => sum + item.inventoryValue, 0)
  };
}

function emptyRow(colspan = 9, text = "아직 입력된 내용이 없습니다.") {
  return `<tr><td colspan="${colspan}" class="empty">${text}</td></tr>`;
}

function deleteButton(type, id) {
  return `<button class="danger-button" data-delete-type="${type}" data-delete-id="${id}">삭제</button>`;
}

function fillProductSelects() {
  const options = state.products
    .map((product) => `<option value="${product.id}">${product.code} · ${productName(product.id)}</option>`)
    .join("");

  $$("select[name='productId']").forEach((select) => {
    const current = select.value;
    select.innerHTML = `<option value="">상품 선택</option>${options}`;
    select.value = current;
  });
}

function renderDashboard() {
  const sum = totals();
  $("#metricInvestment").textContent = money(sum.investment);
  $("#metricInventoryValue").textContent = money(sum.inventoryValue);
  $("#metricRevenue").textContent = money(sum.revenue);
  $("#metricProfit").textContent = money(sum.profit);
}

function renderProducts() {
  $("#productCount").textContent = `${state.products.length}개`;
  $("#productRows").innerHTML = state.products.length
    ? state.products.map((product) => `
      <tr>
        <td>${product.code}</td>
        <td><strong>${product.name}</strong><small>${product.option || "-"}</small></td>
        <td>${product.supplier || "-"}</td>
        <td>${money(product.salePrice)}</td>
        <td>${number(product.reorderLevel)}개</td>
        <td>${deleteButton("products", product.id)}</td>
      </tr>
    `).join("")
    : emptyRow(6);
}

function renderPurchases() {
  $("#purchaseCount").textContent = `${state.purchases.length}건`;
  $("#purchaseRows").innerHTML = state.purchases.length
    ? state.purchases.map((purchase) => `
      <tr>
        <td>${formatDate(purchase.date)}</td>
        <td>${productName(purchase.productId)}</td>
        <td>${number(purchase.quantity)}개</td>
        <td>${purchase.currency} ${number(purchase.unitPrice)}</td>
        <td>${money(purchaseTotal(purchase))}</td>
        <td>${deleteButton("purchases", purchase.id)}</td>
      </tr>
    `).join("")
    : emptyRow(6);
}

function renderCosts() {
  const labels = { allQty: "수량 기준", allValue: "매입금액 기준", product: "특정 상품", business: "공통비" };
  $("#costCount").textContent = `${state.costs.length}건`;
  $("#costRows").innerHTML = state.costs.length
    ? state.costs.map((cost) => `
      <tr>
        <td>${formatDate(cost.date)}</td>
        <td><strong>${cost.name}</strong><small>${cost.memo || "-"}</small></td>
        <td>${cost.category}</td>
        <td>${labels[cost.allocation]}${cost.productId ? ` · ${productName(cost.productId)}` : ""}</td>
        <td>${money(cost.amount)}</td>
        <td>${deleteButton("costs", cost.id)}</td>
      </tr>
    `).join("")
    : emptyRow(6);
}

function renderSales() {
  const { statsMap } = totals();
  $("#saleCount").textContent = `${state.sales.length}건`;
  $("#salesCount").textContent = `${state.sales.length}건`;

  $("#saleRows").innerHTML = state.sales.length
    ? state.sales.map((sale) => {
      const result = saleResult(sale, statsMap);
      return `
        <tr>
          <td>${formatDate(sale.date)}</td>
          <td>${sale.orderNo || "-"}</td>
          <td>${productName(sale.productId)}</td>
          <td>${number(sale.quantity)}개</td>
          <td>${money(result.netRevenue)}</td>
          <td class="${result.profit >= 0 ? "money-good" : "money-bad"}">${money(result.profit)}</td>
          <td>${deleteButton("sales", sale.id)}</td>
        </tr>
      `;
    }).join("")
    : emptyRow(7);

  const recent = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $("#recentSalesRows").innerHTML = recent.length
    ? recent.map((sale) => {
      const result = saleResult(sale, statsMap);
      return `
        <tr>
          <td>${formatDate(sale.date)}</td>
          <td>${productName(sale.productId)}</td>
          <td>${number(sale.quantity)}개</td>
          <td class="${result.profit >= 0 ? "money-good" : "money-bad"}">${money(result.profit)}</td>
        </tr>
      `;
    }).join("")
    : emptyRow(4);
}

function renderInventory() {
  const { stats } = totals();
  $("#inventoryRows").innerHTML = stats.length
    ? stats.map((item) => `
      <tr>
        <td><strong>${item.product.name}</strong><small>${item.product.code} · ${item.product.option || "-"}</small></td>
        <td>${number(item.purchasedQty)}개</td>
        <td>${number(item.soldQty)}개</td>
        <td class="${item.stock <= item.product.reorderLevel ? "money-bad" : ""}">${number(item.stock)}개</td>
        <td>${money(item.avgCost)}</td>
        <td>${money(item.salePrice)}</td>
        <td class="${item.margin >= 0 ? "money-good" : "money-bad"}">${money(item.margin)}</td>
        <td>${Math.round(item.marginRate * 1000) / 10}%</td>
        <td>${money(item.inventoryValue)}</td>
      </tr>
    `).join("")
    : emptyRow(9);

  const lowStock = stats.filter((item) => item.stock <= item.product.reorderLevel);
  $("#lowStockCount").textContent = `${lowStock.length}개`;
  $("#lowStockRows").innerHTML = lowStock.length
    ? lowStock.map((item) => `
      <tr>
        <td>${item.product.name}</td>
        <td class="money-bad">${number(item.stock)}개</td>
        <td>${number(item.product.reorderLevel)}개</td>
        <td>${money(item.margin)}</td>
      </tr>
    `).join("")
    : emptyRow(4, "재고 주의 상품이 없습니다.");
}

function render() {
  $("#defaultRate").value = state.settings.defaultRate;
  fillProductSelects();
  renderDashboard();
  renderProducts();
  renderPurchases();
  renderCosts();
  renderSales();
  renderInventory();
}

function isTyping() {
  const active = document.activeElement;
  return active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName);
}

async function loadFromServer({ quiet = false } = {}) {
  if (syncing) return;

  try {
    if (!quiet) setSyncStatus("불러오는 중…");
    const serverState = await api("/api/state");
    replaceState(serverState);
    render();
    setSyncStatus(`동기화됨 · ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`, "success");
  } catch (error) {
    setSyncStatus("동기화 실패", "error");
    if (!quiet) alert(`데이터를 불러오지 못했습니다.\n${error.message}`);
  }
}

async function save() {
  if (syncing) return;

  const previous = lastSyncedState ? clone(lastSyncedState) : null;
  state.settings.defaultRate = toNum($("#defaultRate").value) || state.settings.defaultRate;
  syncing = true;
  setSyncStatus("저장 중…");

  try {
    const savedState = await api("/api/state", {
      method: "PUT",
      body: JSON.stringify(state)
    });
    replaceState(savedState);
    render();
    setSyncStatus(`저장·동기화 완료 · ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`, "success");
  } catch (error) {
    if (previous) {
      replaceState(previous);
      render();
    }
    setSyncStatus("저장 실패", "error");
    alert(`저장하지 못했습니다.\n${error.message}`);
    throw error;
  } finally {
    syncing = false;
  }
}

function nextProductCode() {
  const used = new Set(state.products.map((product) => product.code));
  let index = 1;

  while (used.has(`CK-${String(index).padStart(3, "0")}`)) {
    index += 1;
  }

  return `CK-${String(index).padStart(3, "0")}`;
}

function bindNavigation() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".nav-button").forEach((item) => item.classList.remove("active"));
      $$(".view").forEach((view) => view.classList.remove("active-view"));
      button.classList.add("active");
      $(`#${button.dataset.view}`).classList.add("active-view");
      $("#viewTitle").textContent = button.textContent;
    });
  });
}

function bindForms() {
  $$("input[type='date']").forEach((input) => {
    input.value = today();
  });

  $("#productForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = parseForm(event.target);

    state.products.push({
      id: uid("P"),
      code: nextProductCode(),
      name: data.name.trim(),
      option: data.option.trim(),
      supplier: data.supplier.trim(),
      salePrice: toNum(data.salePrice),
      reorderLevel: toNum(data.reorderLevel)
    });

    try {
      await save();
      event.target.reset();
    } catch (_) {
      // save()에서 오류를 표시했습니다.
    }
  });

  $("#purchaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = parseForm(event.target);

    state.purchases.push({
      id: uid("B"),
      date: data.date,
      productId: data.productId,
      quantity: toNum(data.quantity),
      currency: data.currency,
      unitPrice: toNum(data.unitPrice),
      exchangeRate: data.currency === "CNY" ? (toNum(data.exchangeRate) || state.settings.defaultRate) : 1,
      shipping: toNum(data.shipping),
      memo: data.memo.trim()
    });

    try {
      await save();
      event.target.reset();
      event.target.date.value = today();
    } catch (_) {
      // save()에서 오류를 표시했습니다.
    }
  });

  $("#costForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = parseForm(event.target);

    state.costs.push({
      id: uid("C"),
      date: data.date,
      name: data.name.trim(),
      category: data.category,
      amount: toNum(data.amount),
      allocation: data.allocation,
      productId: data.allocation === "product" ? data.productId : "",
      memo: data.memo.trim()
    });

    try {
      await save();
      event.target.reset();
      event.target.date.value = today();
    } catch (_) {
      // save()에서 오류를 표시했습니다.
    }
  });

  $("#saleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = parseForm(event.target);

    state.sales.push({
      id: uid("S"),
      date: data.date,
      orderNo: data.orderNo.trim(),
      productId: data.productId,
      quantity: toNum(data.quantity),
      salePrice: toNum(data.salePrice),
      discount: toNum(data.discount),
      shippingIncome: toNum(data.shippingIncome),
      shippingCost: toNum(data.shippingCost),
      packingCost: toNum(data.packingCost),
      platformFee: toNum(data.platformFee)
    });

    try {
      await save();
      event.target.reset();
      event.target.date.value = today();
    } catch (_) {
      // save()에서 오류를 표시했습니다.
    }
  });
}

function bindActions() {
  $("#saveData").addEventListener("click", () => {
    save().catch(() => {});
  });

  $("#refreshData").addEventListener("click", () => {
    loadFromServer().catch(() => {});
  });

  $("#defaultRate").addEventListener("change", () => {
    save().catch(() => {});
  });

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-type]");
    if (!button) return;

    const type = button.dataset.deleteType;
    const id = button.dataset.deleteId;
    const message = type === "products"
      ? "이 상품과 연결된 입고·비용·판매 내역도 함께 삭제됩니다. 정말 삭제할까요?"
      : "이 기록을 삭제할까요?";

    if (!confirm(message)) return;

    if (type === "products") {
      state.products = state.products.filter((item) => String(item.id) !== String(id));
      state.purchases = state.purchases.filter((item) => String(item.productId) !== String(id));
      state.costs = state.costs.filter((item) => String(item.productId) !== String(id));
      state.sales = state.sales.filter((item) => String(item.productId) !== String(id));
    } else {
      state[type] = state[type].filter((item) => String(item.id) !== String(id));
    }

    try {
      await save();
    } catch (_) {
      // save()에서 오류를 표시했습니다.
    }
  });

  $("#resetDemo").addEventListener("click", async () => {
    if (!confirm("모든 상품·입고·비용·판매 데이터를 비울까요?\n이 작업은 되돌릴 수 없습니다.")) return;

    state.settings = { defaultRate: state.settings.defaultRate || 190 };
    state.products = [];
    state.purchases = [];
    state.costs = [];
    state.sales = [];

    try {
      await save();
    } catch (_) {
      // save()에서 오류를 표시했습니다.
    }
  });

  $("#exportJson").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kokring-inventory-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  $("#importJson").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const imported = JSON.parse(await file.text());
      if (!confirm("백업 파일의 내용으로 현재 MariaDB 데이터를 교체할까요?")) {
        event.target.value = "";
        return;
      }

      state.settings = imported.settings || { defaultRate: 190 };
      state.products = Array.isArray(imported.products) ? imported.products : [];
      state.purchases = Array.isArray(imported.purchases) ? imported.purchases : [];
      state.costs = Array.isArray(imported.costs) ? imported.costs : [];
      state.sales = Array.isArray(imported.sales) ? imported.sales : [];

      await save();
    } catch (error) {
      if (error instanceof SyntaxError) {
        alert("올린 파일이 올바른 백업 JSON 파일이 아닙니다.");
      }
    } finally {
      event.target.value = "";
    }
  });

  $("#downloadCsv").addEventListener("click", () => {
    const rows = [
      ["상품코드", "상품명", "입고", "판매", "현재재고", "평균원가", "판매가", "예상마진", "마진율", "재고금액"],
      ...totals().stats.map((item) => [
        item.product.code,
        productName(item.product.id),
        item.purchasedQty,
        item.soldQty,
        item.stock,
        Math.round(item.avgCost),
        item.salePrice,
        Math.round(item.margin),
        `${Math.round(item.marginRate * 1000) / 10}%`,
        Math.round(item.inventoryValue)
      ])
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kokring-inventory-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

async function init() {
  bindNavigation();
  bindForms();
  bindActions();
  await loadFromServer();

  setInterval(() => {
    if (!syncing && !isTyping()) {
      loadFromServer({ quiet: true });
    }
  }, 7000);
}

init();
