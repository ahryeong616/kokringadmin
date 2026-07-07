const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [] };
const formatter = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let accessKey = sessionStorage.getItem('kokring_access_key') || '';
let eventSource;

function today() { return new Date().toISOString().slice(0, 10); }
function money(value) { return formatter.format(Math.round(Number(value) || 0)); }
function number(value) { return new Intl.NumberFormat('ko-KR').format(Math.round(Number(value) || 0)); }
function toNum(value) { return Number(value) || 0; }
function parseForm(form) { return Object.fromEntries(new FormData(form).entries()); }
function productName(productId) { const product = state.products.find((item) => item.id === String(productId)); return product ? (product.option ? `${product.name} / ${product.option}` : product.name) : '삭제된 상품'; }
function purchaseTotal(purchase) { const total = purchase.currency === 'CNY' ? purchase.quantity * purchase.unitPrice * purchase.exchangeRate : purchase.quantity * purchase.unitPrice; return total + toNum(purchase.shipping); }

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
function fillProductSelects() {
  const options = state.products.map((product) => `<option value="${product.id}">${product.code} · ${productName(product.id)}</option>`).join('');
  $$('select[name="productId"]').forEach((select) => { const current = select.value; select.innerHTML = `<option value="">상품 선택</option>${options}`; select.value = current; });
}
function renderDashboard() { const sum = totals(); $('#metricInvestment').textContent = money(sum.investment); $('#metricInventoryValue').textContent = money(sum.inventoryValue); $('#metricRevenue').textContent = money(sum.revenue); $('#metricProfit').textContent = money(sum.profit); }
function renderProducts() { $('#productCount').textContent = `${state.products.length}개`; $('#productRows').innerHTML = state.products.length ? state.products.map((p) => `<tr><td>${p.code}</td><td><strong>${p.name}</strong><small>${p.option || '-'}</small></td><td>${p.supplier || '-'}</td><td>${money(p.salePrice)}</td><td>${number(p.reorderLevel)}개</td><td>${deleteButton('products', p.id)}</td></tr>`).join('') : emptyRow(6); }
function renderPurchases() { $('#purchaseCount').textContent = `${state.purchases.length}건`; $('#purchaseRows').innerHTML = state.purchases.length ? state.purchases.map((p) => `<tr><td>${dateFormatter.format(new Date(p.date))}</td><td>${productName(p.productId)}</td><td>${number(p.quantity)}개</td><td>${p.currency} ${number(p.unitPrice)}</td><td>${money(purchaseTotal(p))}</td><td>${deleteButton('purchases', p.id)}</td></tr>`).join('') : emptyRow(6); }
function renderCosts() { const labels = { allQty: '수량 기준', allValue: '매입금액 기준', product: '특정 상품', business: '공통비' }; $('#costCount').textContent = `${state.costs.length}건`; $('#costRows').innerHTML = state.costs.length ? state.costs.map((c) => `<tr><td>${dateFormatter.format(new Date(c.date))}</td><td><strong>${c.name}</strong><small>${c.memo || '-'}</small></td><td>${c.category}</td><td>${labels[c.allocation]}${c.productId ? ` · ${productName(c.productId)}` : ''}</td><td>${money(c.amount)}</td><td>${deleteButton('costs', c.id)}</td></tr>`).join('') : emptyRow(6); }
function renderSales() { const { statsMap } = totals(); $('#saleCount').textContent = `${state.sales.length}건`; $('#salesCount').textContent = `${state.sales.length}건`; $('#saleRows').innerHTML = state.sales.length ? state.sales.map((s) => { const r = saleResult(s, statsMap); return `<tr><td>${dateFormatter.format(new Date(s.date))}</td><td>${s.orderNo || '-'}</td><td>${productName(s.productId)}</td><td>${number(s.quantity)}개</td><td>${money(r.netRevenue)}</td><td>${money(r.profit)}</td><td>${deleteButton('sales', s.id)}</td></tr>`; }).join('') : emptyRow(7); const recent = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5); $('#recentSalesRows').innerHTML = recent.length ? recent.map((s) => { const r = saleResult(s, statsMap); return `<tr><td>${dateFormatter.format(new Date(s.date))}</td><td>${productName(s.productId)}</td><td>${number(s.quantity)}개</td><td>${money(r.profit)}</td></tr>`; }).join('') : emptyRow(4); }
function renderInventory() { const { stats } = totals(); $('#inventoryRows').innerHTML = stats.length ? stats.map((i) => `<tr><td><strong>${i.product.name}</strong><small>${i.product.code} · ${i.product.option || '-'}</small></td><td>${number(i.purchasedQty)}개</td><td>${number(i.soldQty)}개</td><td>${number(i.stock)}개</td><td>${money(i.avgCost)}</td><td>${money(i.salePrice)}</td><td>${money(i.margin)}</td><td>${Math.round(i.marginRate * 1000) / 10}%</td><td>${money(i.inventoryValue)}</td></tr>`).join('') : emptyRow(9); const low = stats.filter((item) => item.stock <= item.product.reorderLevel); $('#lowStockCount').textContent = `${low.length}개`; $('#lowStockRows').innerHTML = low.length ? low.map((i) => `<tr><td>${i.product.name}</td><td>${number(i.stock)}개</td><td>${number(i.product.reorderLevel)}개</td><td>${money(i.margin)}</td></tr>`).join('') : emptyRow(4, '재고 주의 상품이 없습니다.'); }
function render() { $('#defaultRate').value = state.settings.defaultRate; fillProductSelects(); renderDashboard(); renderProducts(); renderPurchases(); renderCosts(); renderSales(); renderInventory(); }

function bindNavigation() { $$('.nav-button').forEach((button) => button.addEventListener('click', () => { $$('.nav-button').forEach((item) => item.classList.remove('active')); $$('.view').forEach((view) => view.classList.remove('active-view')); button.classList.add('active'); $(`#${button.dataset.view}`).classList.add('active-view'); $('#viewTitle').textContent = button.textContent; })); }
function handleForm(selector, endpoint) { $(selector).addEventListener('submit', async (event) => { event.preventDefault(); try { const next = await api(endpoint, { method: 'POST', body: JSON.stringify(parseForm(event.target)) }); applyState(next); event.target.reset(); const dateInput = event.target.querySelector('input[type="date"]'); if (dateInput) dateInput.value = today(); } catch (err) { alert(err.message); } }); }
function bindForms() { $$('input[type="date"]').forEach((input) => { input.value = today(); }); handleForm('#productForm', '/api/products'); handleForm('#purchaseForm', '/api/purchases'); handleForm('#costForm', '/api/costs'); handleForm('#saleForm', '/api/sales'); }
function seedDemo() { return { settings: { defaultRate: 190 }, products: [{ id: 'P-001', code: 'CK-001', name: '콕링 실버', option: '기본', supplier: '1688', salePrice: 15900, reorderLevel: 20 }, { id: 'P-002', code: 'CK-002', name: '콕링 블랙', option: '무광', supplier: 'Taobao', salePrice: 16900, reorderLevel: 15 }], purchases: [], costs: [], sales: [] }; }
function download(filename, body, type) { const blob = new Blob([body], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
function bindActions() {
  $('#saveData').addEventListener('click', async () => { try { applyState(await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultRate: toNum($('#defaultRate').value) || 190 }) })); } catch (err) { alert(err.message); } });
  $('#defaultRate').addEventListener('change', async () => { try { applyState(await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultRate: toNum($('#defaultRate').value) || 190 }) })); } catch (err) { alert(err.message); } });
  document.body.addEventListener('click', async (event) => { const button = event.target.closest('[data-delete-type]'); if (!button) return; if (!confirm('이 기록을 삭제할까요?')) return; try { applyState(await api(`/api/${button.dataset.deleteType}/${button.dataset.deleteId}`, { method: 'DELETE' })); } catch (err) { alert(err.message); } });
  $('#resetDemo').addEventListener('click', async () => { if (!confirm('현재 클라우드 데이터를 샘플 데이터로 전부 바꿀까요?')) return; try { applyState(await api('/api/import', { method: 'PUT', body: JSON.stringify(seedDemo()) })); } catch (err) { alert(err.message); } });
  $('#exportJson').addEventListener('click', () => download(`kokring-inventory-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('#importJson').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; if (!confirm('현재 클라우드 데이터를 이 백업 파일로 교체할까요?')) { event.target.value = ''; return; } try { applyState(await api('/api/import', { method: 'PUT', body: await file.text() })); } catch (err) { alert(err.message); } finally { event.target.value = ''; } });
  $('#downloadCsv').addEventListener('click', () => { const rows = [['상품코드', '상품명', '입고', '판매', '현재재고', '평균원가', '판매가', '예상마진', '마진율', '재고금액'], ...totals().stats.map((item) => [item.product.code, productName(item.product.id), item.purchasedQty, item.soldQty, item.stock, Math.round(item.avgCost), item.salePrice, Math.round(item.margin), `${Math.round(item.marginRate * 1000) / 10}%`, Math.round(item.inventoryValue)])]; download(`kokring-inventory-${today()}.csv`, `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`, 'text/csv;charset=utf-8'); });
}
function connectEvents() { if (eventSource) eventSource.close(); eventSource = new EventSource('/events'); eventSource.addEventListener('change', () => loadRemote(false)); }
async function init() { setStatus('클라우드 연결 중'); try { await ensureAccess(); await loadRemote(true); connectEvents(); setInterval(() => loadRemote(false), 15000); bindNavigation(); bindForms(); bindActions(); } catch (err) { setStatus('접속 비밀번호 확인 필요', 'error'); alert(err.message); } }
init();
