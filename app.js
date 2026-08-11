const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [] };
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
    const purchaseValue = purchases.reduce((sum, item) => sum + purchaseTotal(item), 0);
    const avgCost = purchasedQty > 0 ? (purchaseValue + (allocated[product.id] || 0)) / purchasedQty : 0;
    const stock = purchasedQty - soldQty;
    const salePrice = toNum(product.salePrice);
    const margin = salePrice - avgCost;
    return { product, purchasedQty, soldQty, stock, avgCost, salePrice, margin, marginRate: salePrice > 0 ? margin / salePrice : 0, inventoryValue: Math.max(stock, 0) * avgCost };
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
function fillSaleFilterProduct() {
  const select = $('#saleFilterProduct');
  if (!select) return;
  const current = saleFilters.productId;
  select.innerHTML = `<option value="">전체 상품</option>${state.products.map((product) => `<option value="${product.id}" ${String(product.id) === String(current) ? 'selected' : ''}>${escapeHtml(product.code)} · ${escapeHtml(productName(product.id))}</option>`).join('')}`;
}
function renderDashboard() { const sum = totals(); $('#metricInvestment').textContent = money(sum.investment); $('#metricInventoryValue').textContent = money(sum.inventoryValue); $('#metricRevenue').textContent = money(sum.revenue); $('#metricProfit').textContent = money(sum.profit); }
function renderProducts() {
  $('#productCount').textContent = `${state.products.length}개`;
  $('#productRows').innerHTML = state.products.length ? state.products.map((p) => {
    if (String(p.id) === String(editingProductId)) return renderProductEditRow(p);
    return `<tr><td>${p.code}</td><td><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.option || '-')}</small></td><td>${escapeHtml(p.supplier || '-')}</td><td>${money(p.salePrice)}</td><td>${number(p.reorderLevel)}개</td><td>${productActionButtons(p.id)}</td></tr>`;
  }).join('') : emptyRow(6);
}
function renderPurchases() {
  $('#purchaseCount').textContent = `${state.purchases.length}건`;
  $('#purchaseRows').innerHTML = state.purchases.length ? state.purchases.map((p) => {
    if (String(p.id) === String(editingPurchaseId)) return renderPurchaseEditRow(p);
    return `<tr><td>${dateFormatter.format(new Date(p.date))}</td><td>${productName(p.productId)}</td><td>${purchaseSupplier(p) || '-'}</td><td>${number(p.quantity)}개</td><td>${p.currency} ${number(p.unitPrice)}</td><td>${money(p.shipping)}</td><td>${p.memo || '-'}</td><td>${money(purchaseTotal(p))}</td><td>${purchaseActionButtons(p.id)}</td></tr>`;
  }).join('') : emptyRow(9);
}
function renderCosts() {
  const labels = { allQty: '수량 기준', allValue: '매입금액 기준', product: '특정 상품', business: '공통비' };
  $('#costCount').textContent = `${state.costs.length}건`;
  $('#costRows').innerHTML = state.costs.length ? state.costs.map((c) => {
    if (String(c.id) === String(editingCostId)) return renderCostEditRow(c);
    return `<tr><td>${dateFormatter.format(new Date(c.date))}</td><td><strong>${c.name}</strong><small>${c.memo || '-'}</small></td><td>${c.category}</td><td>${labels[c.allocation]}${c.productId ? ` · ${productName(c.productId)}` : ''}</td><td>${money(c.amount)}</td><td>${costActionButtons(c.id)}</td></tr>`;
  }).join('') : emptyRow(6);
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
}
function render() { $('#defaultRate').value = state.settings.defaultRate; fillProductSelects(); renderDashboard(); renderProducts(); renderPurchases(); renderCosts(); renderSales(); renderInventory(); }

function bindNavigation() { $$('.nav-button').forEach((button) => button.addEventListener('click', () => { $$('.nav-button').forEach((item) => item.classList.remove('active')); $$('.view').forEach((view) => view.classList.remove('active-view')); button.classList.add('active'); $(`#${button.dataset.view}`).classList.add('active-view'); $('#viewTitle').textContent = button.textContent; })); }
function handleForm(selector, endpoint) { $(selector).addEventListener('submit', async (event) => { event.preventDefault(); try { const next = await api(endpoint, { method: 'POST', body: JSON.stringify(parseForm(event.target)) }); applyState(next); event.target.reset(); const dateInput = event.target.querySelector('input[type="date"]'); if (dateInput) dateInput.value = today(); } catch (err) { alert(err.message); } }); }
function bindForms() { $$('form input[type="date"]').forEach((input) => { input.value = today(); }); handleForm('#productForm', '/api/products'); handleForm('#purchaseForm', '/api/purchases'); handleForm('#costForm', '/api/costs'); handleForm('#saleForm', '/api/sales'); }
function seedDemo() { return { settings: { defaultRate: 190 }, products: [{ id: 'P-001', code: 'CK-001', name: '콕링 실버', option: '기본', supplier: '1688', salePrice: 15900, reorderLevel: 20 }, { id: 'P-002', code: 'CK-002', name: '콕링 블랙', option: '무광', supplier: 'Taobao', salePrice: 16900, reorderLevel: 15 }], purchases: [], costs: [], sales: [] }; }
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
  document.body.addEventListener('click', async (event) => { const button = event.target.closest('[data-delete-type]'); if (!button) return; if (!confirm('이 기록을 삭제할까요?')) return; try { applyState(await api(`/api/${button.dataset.deleteType}/${button.dataset.deleteId}`, { method: 'DELETE' })); } catch (err) { alert(err.message); } });
  $('#resetDemo').addEventListener('click', async () => { if (!confirm('현재 클라우드 데이터를 샘플 데이터로 전부 바꿀까요?')) return; try { applyState(await api('/api/import', { method: 'PUT', body: JSON.stringify(seedDemo()) })); } catch (err) { alert(err.message); } });
  $('#exportJson').addEventListener('click', () => download(`kokring-inventory-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('#importJson').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; if (!confirm('현재 클라우드 데이터를 이 백업 파일로 교체할까요?')) { event.target.value = ''; return; } try { applyState(await api('/api/import', { method: 'PUT', body: await file.text() })); } catch (err) { alert(err.message); } finally { event.target.value = ''; } });
  $('#downloadCsv').addEventListener('click', () => { const rows = [['상품코드', '상품명', '입고', '판매', '현재재고', '평균원가', '판매가', '예상마진', '마진율', '재고금액'], ...totals().stats.map((item) => [item.product.code, productName(item.product.id), item.purchasedQty, item.soldQty, item.stock, Math.round(item.avgCost), item.salePrice, Math.round(item.margin), `${Math.round(item.marginRate * 1000) / 10}%`, Math.round(item.inventoryValue)])]; download(`kokring-inventory-${today()}.csv`, `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`, 'text/csv;charset=utf-8'); });
}
function connectEvents() { if (eventSource) eventSource.close(); eventSource = new EventSource('/events'); eventSource.addEventListener('change', () => loadRemote(false)); }
async function init() { setStatus('클라우드 연결 중'); try { await ensureAccess(); await loadRemote(true); connectEvents(); setInterval(() => loadRemote(false), 15000); bindNavigation(); bindForms(); bindActions(); } catch (err) { setStatus('접속 비밀번호 확인 필요', 'error'); alert(err.message); } }
init();
