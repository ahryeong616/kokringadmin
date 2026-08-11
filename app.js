const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [], adjustments: [] };
const formatter = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let accessKey = sessionStorage.getItem('kokring_access_key') || '';
let eventSource;
let editingPurchaseId = '';
let editingCostId = '';
let editingProductId = '';
let editingSaleId = '';
let saleFilters = { productId: '', from: '', to: '', q: '' };
let purchaseFilters = { productId: '', from: '', to: '', q: '' };
let costFilters = { category: '', from: '', to: '', q: '' };
let productFilters = { q: '' };
let dashboardPeriod = 'thisMonth';

function today() { return new Date().toISOString().slice(0, 10); }
function money(value) { return formatter.format(Math.round(Number(value) || 0)); }
function number(value) { return new Intl.NumberFormat('ko-KR').format(Math.round(Number(value) || 0)); }
function toNum(value) { return Number(value) || 0; }
function parseForm(form) { return Object.fromEntries(new FormData(form).entries()); }
function productName(productId) { const product = state.products.find((item) => item.id === String(productId)); return product ? (product.option ? `${product.name} / ${product.option}` : product.name) : '삭제된 상품'; }
function currentCnyRate() { return toNum(state.settings.defaultRate) || 190; }
function purchaseTotal(purchase) { const total = purchase.currency === 'CNY' ? purchase.quantity * purchase.unitPrice * currentCnyRate() : purchase.quantity * purchase.unitPrice; return total + toNum(purchase.shipping); }
function purchaseSupplier(purchase) {
  if (purchase.supplier) return purchase.supplier;
  const product = state.products.find((item) => item.id === String(purchase.productId));
  return product?.supplier || '';
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function setStatus(message, kind = '') {
  let node = $('#syncStatus');
  if (!node) {
    node = document.createElement('span');
    node.id = 'syncStatus';
    node.className = 'sync-status';
    $('.topbar-actions')?.prepend(node);
  }
  node.className = `sync-status ${kind}`;
  node.textContent = message;
}

async function api(path, options = {}) {
  const headers = { 'x-kokring-access-key': accessKey, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem('kokring_access_key');
    throw new Error(payload.message || '서버 요청에 실패했습니다.');
  }
  return payload;
}

function applyState(nextState) {
  Object.assign(state, nextState);
  render();
}

async function loadRemote(showError = false) {
  try {
    const nextState = await api('/api/state');
    applyState(nextState);
    setStatus('실시간 동기화됨', 'success');
  } catch (err) {
    setStatus('동기화 연결 확인 필요', 'error');
    if (showError) alert(err.message);
  }
}

async function ensureAccess() {
  while (!accessKey) {
    const entered = prompt('콕링 재고관리 접속 비밀번호를 입력해 주세요.');
    if (!entered) throw new Error('접속 비밀번호가 필요합니다.');
    accessKey = entered;
    try {
      await api('/api/health');
      sessionStorage.setItem('kokring_access_key', accessKey);
    } catch (err) {
      accessKey = '';
      alert(err.message);
    }
  }
}

function allocatedCostsByProduct() {
  const map = Object.fromEntries(state.products.map((product) => [product.id, 0]));
  const qty = {}; const value = {};
  state.purchases.forEach((purchase) => {
    qty[purchase.productId] = (qty[purchase.productId] || 0) + purchase.quantity;
    value[purchase.productId] = (value[purchase.productId] || 0) + purchaseTotal(purchase);
  });
  const totalQty = Object.values(qty).reduce((sum, item) => sum + item, 0);
  const totalValue = Object.values(value).reduce((sum, item) => sum + item, 0);
  state.costs.forEach((cost) => {
    if (cost.allocation === 'business') return;
    if (cost.allocation === 'product' && map[cost.productId] !== undefined) { map[cost.productId] += cost.amount; return; }
    state.products.forEach((product) => {
      if (cost.allocation === 'allQty' && totalQty > 0) map[product.id] += cost.amount * ((qty[product.id] || 0) / totalQty);
      if (cost.allocation === 'allValue' && totalValue > 0) map[product.id] += cost.amount * ((value[product.id] || 0) / totalValue);
    });
  });
  return map;
}
function inventoryStats() {
  const allocated = allocatedCostsByProduct();
  return state.products.map((product) => {
    const purchases = state.purchases.filter((item) => item.productId === product.id);
    const sales = state.sales.filter((item) => item.productId === product.id);
    const purchasedQty = purchases.reduce((sum, item) => sum + item.quantity, 0);
    const soldQty = sales.reduce((sum, item) => sum + item.quantity, 0);
    const adjustQty = state.adjustments.filter((item) => item.productId === product.id).reduce((sum, item) => sum + toNum(item.delta), 0);
    const purchaseValue = purchases.reduce((sum, item) => sum + purchaseTotal(item), 0);
    const avgCost = purchasedQty > 0 ? (purchaseValue + (allocated[product.id] || 0)) / purchasedQty : 0;
    const stock = purchasedQty - soldQty + adjustQty;
    const salePrice = toNum(product.salePrice);
    const margin = salePrice - avgCost;
    return { product, purchasedQty, soldQty, adjustQty, stock, avgCost, salePrice, margin, marginRate: salePrice > 0 ? margin / salePrice : 0, inventoryValue: Math.max(stock, 0) * avgCost };
  });
}
function saleResult(sale, statsMap) {
  const stat = statsMap[sale.productId] || { avgCost: 0 };
  const netRevenue = sale.quantity * sale.salePrice - sale.discount + sale.shippingIncome;
  const cogs = sale.quantity * stat.avgCost;
  const expense = sale.shippingCost + sale.packingCost + sale.platformFee;
  return { netRevenue, profit: netRevenue - cogs - expense };
}
function totals() {
  const stats = inventoryStats(); const statsMap = Object.fromEntries(stats.map((item) => [item.product.id, item]));
  return {
    stats, statsMap,
    investment: state.purchases.reduce((sum, item) => sum + purchaseTotal(item), 0) + state.costs.reduce((sum, item) => sum + item.amount, 0),
    revenue: state.sales.reduce((sum, sale) => sum + saleResult(sale, statsMap).netRevenue, 0),
    profit: state.sales.reduce((sum, sale) => sum + saleResult(sale, statsMap).profit, 0),
    inventoryValue: stats.reduce((sum, item) => sum + item.inventoryValue, 0),
  };
}
function emptyRow(colspan = 9, message = '아직 입력된 내용이 없습니다.') { return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`; }
function deleteButton(type, id) { return `<button class="danger-button" data-delete-type="${type}" data-delete-id="${id}">삭제</button>`; }
function purchaseActionButtons(id) { return `<div class="row-actions"><button class="edit-button" data-edit-purchase-id="${id}">수정</button>${deleteButton('purchases', id)}</div>`; }
function costActionButtons(id) { return `<div class="row-actions"><button class="edit-button" data-edit-cost-id="${id}">수정</button>${deleteButton('costs', id)}</div>`; }
function fillProductSelects() {
  const options = state.products.map((product) => `<option value="${product.id}">${product.code} · ${productName(product.id)}</option>`).join('');
  $$('select[name="productId"]').forEach((select) => { const current = select.value; select.innerHTML = `<option value="">상품 선택</option>${options}`; select.value = current; });
}
function productOptions(selectedId = '') {
  return `<option value="">상품 선택</option>${state.products.map((product) => `<option value="${product.id}" ${String(product.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(product.code)} · ${escapeHtml(productName(product.id))}</option>`).join('')}`;
}
function renderPurchaseEditRow(p) {
  return `<tr data-purchase-edit-id="${p.id}">
    <td><input class="inline-input compact" name="date" type="date" value="${escapeHtml(p.date)}" required></td>
    <td><select class="inline-select" name="productId" required>${productOptions(p.productId)}</select></td>
    <td><input class="inline-input" name="supplier" value="${escapeHtml(purchaseSupplier(p))}" placeholder="공급처"></td>
    <td><input class="inline-input compact" name="quantity" type="number" min="1" step="1" value="${p.quantity}" required></td>
    <td>
      <select class="inline-select compact" name="currency"><option value="CNY" ${p.currency === 'CNY' ? 'selected' : ''}>CNY</option><option value="KRW" ${p.currency === 'KRW' ? 'selected' : ''}>KRW</option></select>
      <input class="inline-input compact" name="unitPrice" type="number" min="0" step="0.01" value="${p.unitPrice}" required>
    </td>
    <td><input class="inline-input compact" name="shipping" type="number" min="0" step="1" value="${toNum(p.shipping)}"></td>
    <td><input class="inline-input" name="memo" value="${escapeHtml(p.memo || '')}" placeholder="메모"></td>
    <td>${money(purchaseTotal(p))}<small>CNY 기준 환율 ${number(currentCnyRate())}</small></td>
    <td><div class="row-actions"><button class="primary-button" data-save-purchase-id="${p.id}">저장</button><button class="cancel-button" data-cancel-purchase-edit>취소</button></div></td>
  </tr>`;
}
function readInlinePurchaseRow(row) {
  return Object.fromEntries([...row.querySelectorAll('input[name], select[name]')].map((field) => [field.name, field.value]));
}
function costCategoryOptions(selected = '') {
  return ['포장비', '로고/스티커', '택배/배송', '관세/부가세', '촬영/마케팅', '기타']
    .map((label) => `<option ${label === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}
function costAllocationOptions(selected = '') {
  const labels = {
    allQty: '전체 상품 수량 기준 배분',
    allValue: '전체 매입금액 기준 배분',
    product: '특정 상품에만 반영',
    business: '사업 공통비로만 기록',
  };
  return Object.entries(labels)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}
function renderCostEditRow(c) {
  return `<tr data-cost-edit-id="${c.id}">
    <td><input class="inline-input compact" name="date" type="date" value="${escapeHtml(c.date)}" required></td>
    <td><input class="inline-input" name="name" value="${escapeHtml(c.name)}" placeholder="비용명" required><input class="inline-input" name="memo" value="${escapeHtml(c.memo || '')}" placeholder="메모"></td>
    <td><select class="inline-select" name="category">${costCategoryOptions(c.category)}</select></td>
    <td>
      <select class="inline-select" name="allocation">${costAllocationOptions(c.allocation)}</select>
      <select class="inline-select" name="productId">${productOptions(c.productId)}</select>
    </td>
    <td><input class="inline-input compact" name="amount" type="number" min="0" step="1" value="${toNum(c.amount)}" required></td>
    <td><div class="row-actions"><button class="primary-button" data-save-cost-id="${c.id}">저장</button><button class="cancel-button" data-cancel-cost-edit>취소</button></div></td>
  </tr>`;
}
function readInlineCostRow(row) {
  return Object.fromEntries([...row.querySelectorAll('input[name], select[name]')].map((field) => [field.name, field.value]));
}
function productActionButtons(id) { return `<div class="row-actions"><button class="edit-button" data-edit-product-id="${id}">수정</button>${deleteButton('products', id)}</div>`; }
function saleActionButtons(id) { return `<div class="row-actions"><button class="edit-button" data-edit-sale-id="${id}">수정</button>${deleteButton('sales', id)}</div>`; }
function renderProductEditRow(p) {
  return `<tr data-product-edit-id="${p.id}">
    <td>${escapeHtml(p.code)}</td>
    <td><input class="inline-input" name="name" value="${escapeHtml(p.name)}" placeholder="상품명" required><input class="inline-input" name="option" value="${escapeHtml(p.option || '')}" placeholder="옵션/색상/사이즈"></td>
    <td><input class="inline-input" name="supplier" value="${escapeHtml(p.supplier || '')}" placeholder="공급처"></td>
    <td><input class="inline-input compact" name="salePrice" type="number" min="0" step="1" value="${toNum(p.salePrice)}"></td>
    <td><input class="inline-input compact" name="reorderLevel" type="number" min="0" step="1" value="${toNum(p.reorderLevel)}"></td>
    <td><div class="row-actions"><button class="primary-button" data-save-product-id="${p.id}">저장</button><button class="cancel-button" data-cancel-product-edit>취소</button></div></td>
  </tr>`;
}
function readInlineProductRow(row) {
  return Object.fromEntries([...row.querySelectorAll('input[name], select[name]')].map((field) => [field.name, field.value]));
}
function renderSaleEditRow(s) {
  return `<tr data-sale-edit-id="${s.id}">
    <td><input class="inline-input compact" name="date" type="date" value="${escapeHtml(s.date)}" required></td>
    <td><input class="inline-input" name="orderNo" value="${escapeHtml(s.orderNo || '')}" placeholder="주문번호"></td>
    <td><select class="inline-select" name="productId" required>${productOptions(s.productId)}</select></td>
    <td><input class="inline-input compact" name="quantity" type="number" min="1" step="1" value="${toNum(s.quantity)}" required></td>
    <td>
      <input class="inline-input compact" name="salePrice" type="number" min="0" step="1" value="${toNum(s.salePrice)}" placeholder="개당 판매가" required>
      <input class="inline-input compact" name="discount" type="number" min="0" step="1" value="${toNum(s.discount)}" placeholder="할인">
      <input class="inline-input compact" name="shippingIncome" type="number" min="0" step="1" value="${toNum(s.shippingIncome)}" placeholder="받은 배송비">
    </td>
    <td>
      <input class="inline-input compact" name="shippingCost" type="number" min="0" step="1" value="${toNum(s.shippingCost)}" placeholder="실제 택배비">
      <input class="inline-input compact" name="packingCost" type="number" min="0" step="1" value="${toNum(s.packingCost)}" placeholder="포장비">
      <input class="inline-input compact" name="platformFee" type="number" min="0" step="1" value="${toNum(s.platformFee)}" placeholder="수수료">
    </td>
    <td><div class="row-actions"><button class="primary-button" data-save-sale-id="${s.id}">저장</button><button class="cancel-button" data-cancel-sale-edit>취소</button></div></td>
  </tr>`;
}
function readInlineSaleRow(row) {
  return Object.fromEntries([...row.querySelectorAll('input[name], select[name]')].map((field) => [field.name, field.value]));
}
function stockBadge(stat) {
  if (stat.stock <= 0) return '<span class="stock-badge out">품절</span>';
  if (stat.stock <= toNum(stat.product.reorderLevel)) return '<span class="stock-badge low">부족</span>';
  return '';
}
function stockRowClass(stat) {
  if (stat.stock <= 0) return 'row-out';
  if (stat.stock <= toNum(stat.product.reorderLevel)) return 'row-low';
  return '';
}
function saleMatchesFilter(sale) {
  if (saleFilters.productId && String(sale.productId) !== String(saleFilters.productId)) return false;
  if (saleFilters.from && sale.date < saleFilters.from) return false;
  if (saleFilters.to && sale.date > saleFilters.to) return false;
  if (saleFilters.q && !(sale.orderNo || '').toLowerCase().includes(saleFilters.q.toLowerCase())) return false;
  return true;
}
function productFilterOptions(current) {
  return `<option value="">전체 상품</option>${state.products.map((p) => `<option value="${p.id}" ${String(p.id) === String(current) ? 'selected' : ''}>${escapeHtml(p.code)} · ${escapeHtml(productName(p.id))}</option>`).join('')}`;
}
function fillSaleFilterProduct() { const el = $('#saleFilterProduct'); if (el) el.innerHTML = productFilterOptions(saleFilters.productId); }
function fillPurchaseFilterProduct() { const el = $('#purchaseFilterProduct'); if (el) el.innerHTML = productFilterOptions(purchaseFilters.productId); }

function periodRange(period) {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (period === 'thisMonth') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (period === 'lastMonth') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (period === '3months') return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
  return { from: '', to: '' };
}
function periodLabel(period) { return { all: '전체', thisMonth: '이번 달', lastMonth: '지난 달', '3months': '최근 3개월' }[period] || '기간'; }
function inRange(date, from, to) { if (from && date < from) return false; if (to && date > to) return false; return true; }

function purchaseMatchesFilter(p) {
  if (purchaseFilters.productId && String(p.productId) !== String(purchaseFilters.productId)) return false;
  if (!inRange(p.date, purchaseFilters.from, purchaseFilters.to)) return false;
  if (purchaseFilters.q && !`${purchaseSupplier(p)} ${p.memo || ''}`.toLowerCase().includes(purchaseFilters.q.toLowerCase())) return false;
  return true;
}
function costMatchesFilter(c) {
  if (costFilters.category && c.category !== costFilters.category) return false;
  if (!inRange(c.date, costFilters.from, costFilters.to)) return false;
  if (costFilters.q && !`${c.name} ${c.memo || ''}`.toLowerCase().includes(costFilters.q.toLowerCase())) return false;
  return true;
}
function productMatchesFilter(p) {
  if (!productFilters.q) return true;
  return `${p.code} ${p.name} ${p.option || ''} ${p.supplier || ''}`.toLowerCase().includes(productFilters.q.toLowerCase());
}

function adjustmentActionButtons(id) { return `<div class="row-actions">${deleteButton('adjustments', id)}</div>`; }
function renderAdjustments() {
  $('#adjustmentCount').textContent = `${state.adjustments.length}건`;
  $('#adjustmentRows').innerHTML = state.adjustments.length ? [...state.adjustments].reverse().map((a) => {
    const inc = toNum(a.delta) >= 0;
    return `<tr><td>${dateFormatter.format(new Date(a.date))}</td><td>${productName(a.productId)}</td><td><span class="tag ${inc ? 'inc' : 'dec'}">${inc ? '증가 ＋' : '감소 −'}</span></td><td>${escapeHtml(a.reason)}</td><td>${inc ? '+' : '−'}${number(a.quantity)}개</td><td>${escapeHtml(a.memo || '-')}</td><td>${adjustmentActionButtons(a.id)}</td></tr>`;
  }).join('') : emptyRow(7);
}

function updateSalePreview() {
  const form = $('#saleForm'); const box = $('#salePreview');
  if (!form || !box) return;
  const f = parseForm(form);
  if (!f.productId || !toNum(f.quantity)) { box.hidden = true; return; }
  const { statsMap } = totals();
  const draft = {
    productId: String(f.productId), quantity: toNum(f.quantity), salePrice: toNum(f.salePrice),
    discount: toNum(f.discount), shippingIncome: toNum(f.shippingIncome), shippingCost: toNum(f.shippingCost),
    packingCost: toNum(f.packingCost), platformFee: toNum(f.platformFee),
  };
  const r = saleResult(draft, statsMap);
  const stat = statsMap[draft.productId];
  const stock = stat ? stat.stock : 0;
  box.hidden = false;
  box.className = `form-preview ${r.profit < 0 ? 'bad' : 'good'}`;
  box.innerHTML = `<span>예상 매출 <strong>${money(r.netRevenue)}</strong></span><span>예상 순이익 <strong>${money(r.profit)}</strong></span><span>판매 후 재고 <strong>${number(stock - draft.quantity)}개</strong></span>`;
}
function autofillSalePrice() {
  const form = $('#saleForm'); if (!form) return;
  const sel = form.querySelector('select[name="productId"]'); const price = form.querySelector('input[name="salePrice"]');
  if (!sel || !price) return;
  const product = state.products.find((p) => p.id === String(sel.value));
  if (product && !price.value) price.value = toNum(product.salePrice) || '';
  updateSalePreview();
}

function monthKey(date) { return String(date).slice(0, 7); }
function renderMonthlyChart() {
  const el = $('#monthlyChart'); if (!el) return;
  const { statsMap } = totals();
  const now = new Date(); const months = [];
  for (let i = 5; i >= 0; i -= 1) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const rev = {}; const prof = {};
  months.forEach((mk) => { rev[mk] = 0; prof[mk] = 0; });
  state.sales.forEach((s) => { const mk = monthKey(s.date); if (mk in rev) { const r = saleResult(s, statsMap); rev[mk] += r.netRevenue; prof[mk] += r.profit; } });
  const maxVal = Math.max(1, ...months.map((mk) => Math.max(rev[mk], prof[mk], 0)));
  const bars = months.map((mk) => {
    const rH = Math.max(0, (rev[mk] / maxVal) * 100); const pH = Math.max(0, (prof[mk] / maxVal) * 100);
    return `<div class="chart-col"><div class="chart-bars"><div class="bar rev" style="height:${rH}%" title="매출 ${money(rev[mk])}"></div><div class="bar prof" style="height:${pH}%" title="순이익 ${money(prof[mk])}"></div></div><span class="chart-x">${Number(mk.slice(5))}월</span></div>`;
  }).join('');
  el.innerHTML = `<div class="chart-bars-row">${bars}</div>`;
}
function renderBestseller(period) {
  const { statsMap } = totals();
  const { from, to } = periodRange(period);
  const map = {};
  state.sales.forEach((s) => {
    if (!inRange(s.date, from, to)) return;
    const r = saleResult(s, statsMap);
    if (!map[s.productId]) map[s.productId] = { productId: s.productId, qty: 0, revenue: 0, profit: 0 };
    map[s.productId].qty += s.quantity; map[s.productId].revenue += r.netRevenue; map[s.productId].profit += r.profit;
  });
  const rows = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
  $('#bestsellerPeriod').textContent = periodLabel(period);
  $('#bestsellerRows').innerHTML = rows.length ? rows.map((r) => `<tr><td>${productName(r.productId)}</td><td>${number(r.qty)}개</td><td>${money(r.revenue)}</td><td class="${r.profit < 0 ? 'money-bad' : ''}">${money(r.profit)}</td></tr>`).join('') : emptyRow(4, '판매 기록이 없습니다.');
}
function renderDashboard() {
  const sum = totals();
  const { statsMap } = sum;
  const { from, to } = periodRange(dashboardPeriod);
  const periodSales = state.sales.filter((s) => inRange(s.date, from, to));
  const pRevenue = periodSales.reduce((acc, s) => acc + saleResult(s, statsMap).netRevenue, 0);
  const pProfit = periodSales.reduce((acc, s) => acc + saleResult(s, statsMap).profit, 0);
  $('#metricInvestment').textContent = money(sum.investment);
  $('#metricInventoryValue').textContent = money(sum.inventoryValue);
  $('#metricRevenue').textContent = money(pRevenue);
  $('#metricProfit').textContent = money(pProfit);
  const label = periodLabel(dashboardPeriod);
  $('#metricRevenueLabel').textContent = `${label} 매출`;
  $('#metricProfitLabel').textContent = `${label} 순이익`;
  $$('#periodBar .chip').forEach((c) => c.classList.toggle('active', c.dataset.period === dashboardPeriod));
  renderMonthlyChart();
  renderBestseller(dashboardPeriod);
}
function renderProducts() {
  const list = state.products.filter((p) => productMatchesFilter(p) || String(p.id) === String(editingProductId));
  $('#productCount').textContent = list.length !== state.products.length ? `${list.length}개 / 전체 ${state.products.length}개` : `${state.products.length}개`;
  $('#productRows').innerHTML = list.length ? list.map((p) => {
    if (String(p.id) === String(editingProductId)) return renderProductEditRow(p);
    return `<tr><td>${p.code}</td><td><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.option || '-')}</small></td><td>${escapeHtml(p.supplier || '-')}</td><td>${money(p.salePrice)}</td><td>${number(p.reorderLevel)}개</td><td>${productActionButtons(p.id)}</td></tr>`;
  }).join('') : emptyRow(6, state.products.length ? '검색 결과가 없습니다.' : '아직 입력된 내용이 없습니다.');
}
function renderPurchases() {
  fillPurchaseFilterProduct();
  const list = state.purchases.filter((p) => purchaseMatchesFilter(p) || String(p.id) === String(editingPurchaseId));
  $('#purchaseCount').textContent = list.length !== state.purchases.length ? `${list.length}건 / 전체 ${state.purchases.length}건` : `${state.purchases.length}건`;
  $('#purchaseRows').innerHTML = list.length ? list.map((p) => {
    if (String(p.id) === String(editingPurchaseId)) return renderPurchaseEditRow(p);
    return `<tr><td>${dateFormatter.format(new Date(p.date))}</td><td>${productName(p.productId)}</td><td>${purchaseSupplier(p) || '-'}</td><td>${number(p.quantity)}개</td><td>${p.currency} ${number(p.unitPrice)}</td><td>${money(p.shipping)}</td><td>${p.memo || '-'}</td><td>${money(purchaseTotal(p))}</td><td>${purchaseActionButtons(p.id)}</td></tr>`;
  }).join('') : emptyRow(9, state.purchases.length ? '조건에 맞는 입고 내역이 없습니다.' : '아직 입력된 내용이 없습니다.');
}
function renderCosts() {
  const labels = { allQty: '수량 기준', allValue: '매입금액 기준', product: '특정 상품', business: '공통비' };
  const list = state.costs.filter((c) => costMatchesFilter(c) || String(c.id) === String(editingCostId));
  $('#costCount').textContent = list.length !== state.costs.length ? `${list.length}건 / 전체 ${state.costs.length}건` : `${state.costs.length}건`;
  $('#costRows').innerHTML = list.length ? list.map((c) => {
    if (String(c.id) === String(editingCostId)) return renderCostEditRow(c);
    return `<tr><td>${dateFormatter.format(new Date(c.date))}</td><td><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.memo || '-')}</small></td><td>${escapeHtml(c.category)}</td><td>${labels[c.allocation]}${c.productId ? ` · ${productName(c.productId)}` : ''}</td><td>${money(c.amount)}</td><td>${costActionButtons(c.id)}</td></tr>`;
  }).join('') : emptyRow(6, state.costs.length ? '조건에 맞는 비용 내역이 없습니다.' : '아직 입력된 내용이 없습니다.');
}
function renderSales() {
  const { statsMap } = totals();
  fillSaleFilterProduct();
  const filtered = state.sales.filter(saleMatchesFilter);
  const isFiltered = filtered.length !== state.sales.length;
  $('#saleCount').textContent = isFiltered ? `${filtered.length}건 / 전체 ${state.sales.length}건` : `${state.sales.length}건`;
  $('#salesCount').textContent = `${state.sales.length}건`;
  $('#saleRows').innerHTML = filtered.length ? filtered.map((s) => {
    if (String(s.id) === String(editingSaleId)) return renderSaleEditRow(s);
    const r = saleResult(s, statsMap);
    return `<tr><td>${dateFormatter.format(new Date(s.date))}</td><td>${escapeHtml(s.orderNo || '-')}</td><td>${productName(s.productId)}</td><td>${number(s.quantity)}개</td><td>${money(r.netRevenue)}</td><td class="${r.profit < 0 ? 'money-bad' : ''}">${money(r.profit)}</td><td>${saleActionButtons(s.id)}</td></tr>`;
  }).join('') : emptyRow(7, state.sales.length ? '조건에 맞는 판매 내역이 없습니다.' : '아직 입력된 내용이 없습니다.');
  const recent = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#recentSalesRows').innerHTML = recent.length ? recent.map((s) => { const r = saleResult(s, statsMap); return `<tr><td>${dateFormatter.format(new Date(s.date))}</td><td>${productName(s.productId)}</td><td>${number(s.quantity)}개</td><td>${money(r.profit)}</td></tr>`; }).join('') : emptyRow(4);
}
function renderInventory() {
  const { stats } = totals();
  $('#inventoryRows').innerHTML = stats.length ? stats.map((i) => `<tr class="${stockRowClass(i)}"><td><strong>${escapeHtml(i.product.name)}</strong><small>${escapeHtml(i.product.code)} · ${escapeHtml(i.product.option || '-')}</small></td><td>${number(i.purchasedQty)}개</td><td>${number(i.soldQty)}개</td><td>${number(i.stock)}개${stockBadge(i)}</td><td>${money(i.avgCost)}</td><td>${money(i.salePrice)}</td><td class="${i.margin < 0 ? 'money-bad' : ''}">${money(i.margin)}</td><td>${Math.round(i.marginRate * 1000) / 10}%</td><td>${money(i.inventoryValue)}</td></tr>`).join('') : emptyRow(9);
  const low = stats.filter((item) => item.stock <= toNum(item.product.reorderLevel));
  $('#lowStockCount').textContent = `${low.length}개`;
  $('#lowStockRows').innerHTML = low.length ? low.map((i) => `<tr class="${stockRowClass(i)}"><td>${escapeHtml(i.product.name)}</td><td>${number(i.stock)}개${stockBadge(i)}</td><td>${number(i.product.reorderLevel)}개</td><td>${money(i.margin)}</td></tr>`).join('') : emptyRow(4, '재고 주의 상품이 없습니다.');
  const badge = $('#navLowStock');
  if (badge) { badge.textContent = low.length; badge.hidden = low.length === 0; }
}
function render() { $('#defaultRate').value = state.settings.defaultRate; fillProductSelects(); renderDashboard(); renderProducts(); renderPurchases(); renderCosts(); renderSales(); renderAdjustments(); renderInventory(); updateSalePreview(); }

function bindNavigation() { $$('.nav-button').forEach((button) => button.addEventListener('click', () => { $$('.nav-button').forEach((item) => item.classList.remove('active')); $$('.view').forEach((view) => view.classList.remove('active-view')); button.classList.add('active'); $(`#${button.dataset.view}`).classList.add('active-view'); $('#viewTitle').textContent = button.textContent; })); }
function handleForm(selector, endpoint) { $(selector).addEventListener('submit', async (event) => { event.preventDefault(); try { const next = await api(endpoint, { method: 'POST', body: JSON.stringify(parseForm(event.target)) }); applyState(next); event.target.reset(); const dateInput = event.target.querySelector('input[type="date"]'); if (dateInput) dateInput.value = today(); } catch (err) { alert(err.message); } }); }
function bindForms() { $$('form input[type="date"]').forEach((input) => { input.value = today(); }); handleForm('#productForm', '/api/products'); handleForm('#purchaseForm', '/api/purchases'); handleForm('#costForm', '/api/costs'); handleForm('#saleForm', '/api/sales'); handleForm('#adjustmentForm', '/api/adjustments'); }
function seedDemo() { return { settings: { defaultRate: 190 }, products: [{ id: 'P-001', code: 'CK-001', name: '콕링 실버', option: '기본', supplier: '1688', salePrice: 15900, reorderLevel: 20 }, { id: 'P-002', code: 'CK-002', name: '콕링 블랙', option: '무광', supplier: 'Taobao', salePrice: 16900, reorderLevel: 15 }], purchases: [], costs: [], sales: [], adjustments: [] }; }
function download(filename, body, type) { const blob = new Blob([body], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
function bindActions() {
  $('#saveData').addEventListener('click', async () => { try { applyState(await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultRate: toNum($('#defaultRate').value) || 190 }) })); } catch (err) { alert(err.message); } });
  $('#defaultRate').addEventListener('change', async () => { try { applyState(await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultRate: toNum($('#defaultRate').value) || 190 }) })); } catch (err) { alert(err.message); } });
  $('#refreshData').addEventListener('click', () => loadRemote(true));
  document.body.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit-purchase-id]');
    if (!editButton) return;
    editingPurchaseId = editButton.dataset.editPurchaseId;
    renderPurchases();
  });
  document.body.addEventListener('click', (event) => {
    if (!event.target.closest('[data-cancel-purchase-edit]')) return;
    editingPurchaseId = '';
    renderPurchases();
  });
  document.body.addEventListener('click', async (event) => {
    const saveButton = event.target.closest('[data-save-purchase-id]');
    if (!saveButton) return;
    const row = saveButton.closest('[data-purchase-edit-id]');
    if (!row) return;
    const body = readInlinePurchaseRow(row);
    try {
      const nextState = await api(`/api/purchases/${saveButton.dataset.savePurchaseId}`, { method: 'PATCH', body: JSON.stringify(body) });
      editingPurchaseId = '';
      applyState(nextState);
    } catch (err) {
      alert(err.message);
    }
  });
  document.body.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-edit-cost-id]');
    if (!editButton) return;
    editingCostId = editButton.dataset.editCostId;
    renderCosts();
  });
  document.body.addEventListener('click', (event) => {
    if (!event.target.closest('[data-cancel-cost-edit]')) return;
    editingCostId = '';
    renderCosts();
  });
  document.body.addEventListener('click', async (event) => {
    const saveButton = event.target.closest('[data-save-cost-id]');
    if (!saveButton) return;
    const row = saveButton.closest('[data-cost-edit-id]');
    if (!row) return;
    const body = readInlineCostRow(row);
    try {
      const nextState = await api(`/api/costs/${saveButton.dataset.saveCostId}`, { method: 'PATCH', body: JSON.stringify(body) });
      editingCostId = '';
      applyState(nextState);
    } catch (err) {
      alert(err.message);
    }
  });
  document.body.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-product-id]');
    if (!editButton) return;
    editingProductId = editButton.dataset.editProductId;
    renderProducts();
  });
  document.body.addEventListener('click', (event) => {
    if (!event.target.closest('[data-cancel-product-edit]')) return;
    editingProductId = '';
    renderProducts();
  });
  document.body.addEventListener('click', async (event) => {
    const saveButton = event.target.closest('[data-save-product-id]');
    if (!saveButton) return;
    const row = saveButton.closest('[data-product-edit-id]');
    if (!row) return;
    try {
      const nextState = await api(`/api/products/${saveButton.dataset.saveProductId}`, { method: 'PATCH', body: JSON.stringify(readInlineProductRow(row)) });
      editingProductId = '';
      applyState(nextState);
    } catch (err) { alert(err.message); }
  });
  document.body.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-sale-id]');
    if (!editButton) return;
    editingSaleId = editButton.dataset.editSaleId;
    renderSales();
  });
  document.body.addEventListener('click', (event) => {
    if (!event.target.closest('[data-cancel-sale-edit]')) return;
    editingSaleId = '';
    renderSales();
  });
  document.body.addEventListener('click', async (event) => {
    const saveButton = event.target.closest('[data-save-sale-id]');
    if (!saveButton) return;
    const row = saveButton.closest('[data-sale-edit-id]');
    if (!row) return;
    try {
      const nextState = await api(`/api/sales/${saveButton.dataset.saveSaleId}`, { method: 'PATCH', body: JSON.stringify(readInlineSaleRow(row)) });
      editingSaleId = '';
      applyState(nextState);
    } catch (err) { alert(err.message); }
  });
  const bindSaleFilter = (id, key) => { const el = $(`#${id}`); if (el) el.addEventListener('input', () => { saleFilters[key] = el.value; renderSales(); }); };
  bindSaleFilter('saleFilterProduct', 'productId');
  bindSaleFilter('saleFilterFrom', 'from');
  bindSaleFilter('saleFilterTo', 'to');
  bindSaleFilter('saleFilterQuery', 'q');
  $('#saleFilterReset')?.addEventListener('click', () => {
    saleFilters = { productId: '', from: '', to: '', q: '' };
    ['saleFilterProduct', 'saleFilterFrom', 'saleFilterTo', 'saleFilterQuery'].forEach((id) => { const el = $(`#${id}`); if (el) el.value = ''; });
    renderSales();
  });
  const bindFilter = (id, obj, key, rerender) => { const el = $(`#${id}`); if (el) el.addEventListener('input', () => { obj[key] = el.value; rerender(); }); };
  const pq = $('#productFilterQuery');
  if (pq) pq.addEventListener('input', () => { productFilters.q = pq.value; renderProducts(); });
  $('#productFilterReset')?.addEventListener('click', () => { productFilters.q = ''; if (pq) pq.value = ''; renderProducts(); });
  bindFilter('purchaseFilterProduct', purchaseFilters, 'productId', renderPurchases);
  bindFilter('purchaseFilterFrom', purchaseFilters, 'from', renderPurchases);
  bindFilter('purchaseFilterTo', purchaseFilters, 'to', renderPurchases);
  bindFilter('purchaseFilterQuery', purchaseFilters, 'q', renderPurchases);
  $('#purchaseFilterReset')?.addEventListener('click', () => { purchaseFilters = { productId: '', from: '', to: '', q: '' }; ['purchaseFilterProduct', 'purchaseFilterFrom', 'purchaseFilterTo', 'purchaseFilterQuery'].forEach((id) => { const el = $(`#${id}`); if (el) el.value = ''; }); renderPurchases(); });
  bindFilter('costFilterCategory', costFilters, 'category', renderCosts);
  bindFilter('costFilterFrom', costFilters, 'from', renderCosts);
  bindFilter('costFilterTo', costFilters, 'to', renderCosts);
  bindFilter('costFilterQuery', costFilters, 'q', renderCosts);
  $('#costFilterReset')?.addEventListener('click', () => { costFilters = { category: '', from: '', to: '', q: '' }; ['costFilterCategory', 'costFilterFrom', 'costFilterTo', 'costFilterQuery'].forEach((id) => { const el = $(`#${id}`); if (el) el.value = ''; }); renderCosts(); });
  $$('.quick-dates .chip').forEach((btn) => btn.addEventListener('click', () => {
    const which = btn.closest('.quick-dates')?.dataset.filter; const range = btn.dataset.range;
    const now = new Date(); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let from = ''; const to = iso(now);
    if (range === 'today') from = iso(now);
    else if (range === 'week') { const wd = (now.getDay() + 6) % 7; from = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - wd)); }
    else if (range === 'month') from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const apply = (obj, ids, rerender) => { obj.from = from; obj.to = to; const [a, b] = ids; if ($(`#${a}`)) $(`#${a}`).value = from; if ($(`#${b}`)) $(`#${b}`).value = to; rerender(); };
    if (which === 'sale') apply(saleFilters, ['saleFilterFrom', 'saleFilterTo'], renderSales);
    if (which === 'purchase') apply(purchaseFilters, ['purchaseFilterFrom', 'purchaseFilterTo'], renderPurchases);
    if (which === 'cost') apply(costFilters, ['costFilterFrom', 'costFilterTo'], renderCosts);
  }));
  $$('#periodBar .chip').forEach((btn) => btn.addEventListener('click', () => { dashboardPeriod = btn.dataset.period; renderDashboard(); }));
  const saleForm = $('#saleForm');
  if (saleForm) {
    saleForm.querySelector('select[name="productId"]')?.addEventListener('change', autofillSalePrice);
    saleForm.addEventListener('input', updateSalePreview);
  }
  document.body.addEventListener('click', async (event) => { const button = event.target.closest('[data-delete-type]'); if (!button) return; if (!confirm('이 기록을 삭제할까요?')) return; try { applyState(await api(`/api/${button.dataset.deleteType}/${button.dataset.deleteId}`, { method: 'DELETE' })); } catch (err) { alert(err.message); } });
  $('#resetDemo').addEventListener('click', async () => { if (!confirm('현재 클라우드 데이터를 샘플 데이터로 전부 바꿀까요?')) return; try { applyState(await api('/api/import', { method: 'PUT', body: JSON.stringify(seedDemo()) })); } catch (err) { alert(err.message); } });
  $('#exportJson').addEventListener('click', () => download(`kokring-inventory-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('#importJson').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; if (!confirm('현재 클라우드 데이터를 이 백업 파일로 교체할까요?')) { event.target.value = ''; return; } try { applyState(await api('/api/import', { method: 'PUT', body: await file.text() })); } catch (err) { alert(err.message); } finally { event.target.value = ''; } });
  $('#downloadCsv').addEventListener('click', () => { const rows = [['상품코드', '상품명', '입고', '판매', '현재재고', '평균원가', '판매가', '예상마진', '마진율', '재고금액'], ...totals().stats.map((item) => [item.product.code, productName(item.product.id), item.purchasedQty, item.soldQty, item.stock, Math.round(item.avgCost), item.salePrice, Math.round(item.margin), `${Math.round(item.marginRate * 1000) / 10}%`, Math.round(item.inventoryValue)])]; download(`kokring-inventory-${today()}.csv`, `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`, 'text/csv;charset=utf-8'); });
}
function connectEvents() { if (eventSource) eventSource.close(); eventSource = new EventSource('/events'); eventSource.addEventListener('change', () => loadRemote(false)); }
async function init() { setStatus('클라우드 연결 중'); try { await ensureAccess(); await loadRemote(true); connectEvents(); setInterval(() => loadRemote(false), 15000); bindNavigation(); bindForms(); bindActions(); } catch (err) { setStatus('접속 비밀번호 확인 필요', 'error'); alert(err.message); } }
init();
