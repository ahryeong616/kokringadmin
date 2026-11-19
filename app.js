const state = { settings: { defaultRate: 190 }, products: [], purchases: [], costs: [], sales: [], adjustments: [] };
const formatter = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let accessKey = sessionStorage.getItem('kokring_access_key') || '';
let eventSource;
let historicalCostCache = new Map();
let editingPurchaseId = '';
let editingCostId = '';
let editingProductId = '';
let editingSaleId = '';
let salesPage = 1;
let salesPageSize = 20;
let salesFilterSignature = '';
let saleFilters = { productId: '', from: '', to: '', q: '' };
let purchaseFilters = { productId: '', from: '', to: '', q: '' };
let costFilters = { category: '', from: '', to: '', q: '' };
let productFilters = { q: '', category: '' };
let mergingProductId = '';
const selectedProductIds = new Set();
let dashboardPeriod = 'thisMonth';
let dashboardFocusTab = 'restock';
let dashboardExpanded = false;
let selectedChartMonth = '';
let summaryFilters = { category: '', q: '', sort: 'quantity-desc' };
let inventorySort = 'category';
let inventoryFilters = { type:'set', category: '', status: '', q: '' };

function today() { return new Date().toISOString().slice(0, 10); }
function money(value) { return formatter.format(Math.round(Number(value) || 0)); }
function number(value) { return new Intl.NumberFormat('ko-KR').format(Math.round(Number(value) || 0)); }
function toNum(value) { return Number(value) || 0; }
function parseForm(form) { return Object.fromEntries(new FormData(form).entries()); }
function productName(productId) { const product = state.products.find((item) => item.id === String(productId)); return product ? (product.option ? `${product.name} / ${product.option}` : product.name) : '삭제된 상품'; }
function currentCnyRate() { return toNum(state.settings.defaultRate) || 190; }
function purchaseTotal(purchase) { const total = purchase.currency === 'CNY' ? purchase.quantity * purchase.unitPrice * (toNum(purchase.exchangeRate) || currentCnyRate()) : purchase.quantity * purchase.unitPrice; return total + toNum(purchase.shipping); }
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

function allocatedCostsByProduct(source=state) {
  const map = Object.fromEntries(source.products.map((product) => [product.id, 0]));
  const qty = {}; const value = {};
  source.purchases.forEach((purchase) => {
    qty[purchase.productId] = (qty[purchase.productId] || 0) + purchase.quantity;
    value[purchase.productId] = (value[purchase.productId] || 0) + purchaseTotal(purchase);
  });
  const totalQty = Object.values(qty).reduce((sum, item) => sum + item, 0);
  const totalValue = Object.values(value).reduce((sum, item) => sum + item, 0);
  source.costs.filter(cost=>Finance.costInfo(state,cost).kind==='inventory').forEach((cost) => {
    if (cost.allocation === 'business') return;
    if (cost.allocation === 'product' && map[cost.productId] !== undefined) { map[cost.productId] += cost.amount; return; }
    source.products.forEach((product) => {
      if (cost.allocation === 'allQty' && totalQty > 0) map[product.id] += cost.amount * ((qty[product.id] || 0) / totalQty);
      if (cost.allocation === 'allValue' && totalValue > 0) map[product.id] += cost.amount * ((value[product.id] || 0) / totalValue);
    });
  });
  return map;
}
function finishedStocktake(a) {
  if (a.reason !== '완제품 실사') return null;
  try { const data=JSON.parse(a.memo); return data.kind==='finished-stocktake-v1'?data:null; } catch (_) { return null; }
}
function inventoryStats() {
  return ComponentInventory.calculate(state, purchaseTotal, allocatedCostsByProduct());
}
function saleResult(sale,statsMap){return Finance.saleResult(state,sale,statsMap);}
function financeReport(from='',to=''){return Finance.report(state,totals().statsMap,from,to,purchaseTotal);}
function totals() {
  const stats = inventoryStats(); const statsMap = Object.fromEntries(stats.map((item) => [item.product.id, item]));
  statsMap._saleCosts={};
  for(const sale of state.sales){
    if(!historicalCostCache.has(sale.date)){
      const snapshot={...state,purchases:state.purchases.filter(p=>p.date<=sale.date),costs:state.costs.filter(c=>c.date<=sale.date)};
      const historical=ComponentInventory.calculate(snapshot,purchaseTotal,allocatedCostsByProduct(snapshot));
      historicalCostCache.set(sale.date,Object.fromEntries(historical.map(s=>[s.product.id,s.avgCost])));
    }
    statsMap._saleCosts[sale.id]=(historicalCostCache.get(sale.date)[sale.productId]||0)*sale.quantity;
  }
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
function singleProducts() { return state.products.filter((p) => p.type !== 'set'); }
function productLabel(p) { return `${p.code} · ${productName(p.id)}${p.type === 'set' ? ' (세트)' : ' (단품)'}`; }
function optionsFrom(list, selectedId, placeholder) {
  return `<option value="">${placeholder}</option>${list.map((p) => `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(productLabel(p))}</option>`).join('')}`;
}
function fillProductSelects() {
  $$('select[name="productId"]').forEach((select) => {
    const includeSets = !!select.closest('#saleForm, #adjustmentForm, #purchaseForm'); // 입고·판매·재고조정은 단품과 세트 모두 선택
    const current = select.value;
    select.innerHTML = optionsFrom(includeSets ? state.products : singleProducts(), current, '상품 선택');
    select.value = current;
  });
}
function productOptions(selectedId = '', list = state.products) { return optionsFrom(list, selectedId, '상품 선택'); }
function renderPurchaseEditRow(p) {
  return `<tr data-purchase-edit-id="${p.id}">
    <td><input class="inline-input compact" name="date" type="date" value="${escapeHtml(p.date)}" required></td>
    <td><select class="inline-select" name="productId" required>${productOptions(p.productId)}</select></td>
    <td><input class="inline-input" name="supplier" value="${escapeHtml(purchaseSupplier(p))}" placeholder="공급처"></td>
    <td><input class="inline-input compact" name="quantity" type="number" min="1" step="1" value="${p.quantity}" required></td>
    <td>
      <select class="inline-select compact" name="currency"><option value="CNY" ${p.currency === 'CNY' ? 'selected' : ''}>CNY</option><option value="KRW" ${p.currency === 'KRW' ? 'selected' : ''}>KRW</option></select>
      <input class="inline-input compact" name="exchangeRate" type="number" min="0.01" step="0.01" value="${toNum(p.exchangeRate)||currentCnyRate()}" aria-label="입고 환율"><input class="inline-input compact" name="unitPrice" type="number" min="0" step="0.01" value="${p.unitPrice}" required>
    </td>
    <td><input class="inline-input compact" name="shipping" type="number" min="0" step="1" value="${toNum(p.shipping)}"></td>
    <td><input class="inline-input" name="memo" value="${escapeHtml(p.memo || '')}" placeholder="메모"></td>
    <td>${money(purchaseTotal(p))}<small>입고 기록 환율 ${number(toNum(p.exchangeRate)||currentCnyRate())}</small></td>
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
    allQty: '상품 확보 원가만: 전체 수량 배분',
    allValue: '상품 확보 원가만: 매입금액 배분',
    product: '상품 확보 원가만: 특정 상품',
    business: '상품 원가 배분 안 함',
  };
  return Object.entries(labels)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}
function renderCostEditRow(c) {
  return `<tr data-cost-edit-id="${c.id}">
    <td><input class="inline-input compact" name="date" type="date" value="${escapeHtml(c.date)}" required></td>
    <td><div class="stack-inputs"><input class="inline-input" name="name" value="${escapeHtml(c.name)}" placeholder="비용명" required><input class="inline-input" name="memo" value="${escapeHtml(c.memo || '')}" placeholder="메모"></div></td>
    <td><select class="inline-select" name="category">${costCategoryOptions(c.category)}</select></td>
    <td>
      <select class="inline-select" name="allocation">${costAllocationOptions(c.allocation)}</select>
      <select class="inline-select" name="productId">${productOptions(c.productId, singleProducts())}</select>
    </td>
    <td><input class="inline-input compact" name="amount" type="number" min="0" step="1" value="${toNum(c.amount)}" required></td>
    <td><div class="row-actions"><button class="primary-button" data-save-cost-id="${c.id}">저장</button><button class="cancel-button" data-cancel-cost-edit>취소</button></div></td>
  </tr>`;
}
function readInlineCostRow(row) {
  return Object.fromEntries([...row.querySelectorAll('input[name], select[name]')].map((field) => [field.name, field.value]));
}
function productActionButtons(product) {
  const editAttr = product.type === 'set' ? `data-edit-set-id="${product.id}"` : `data-edit-product-id="${product.id}"`;
  const mergeBtn = product.type !== 'set' ? `<button class="ghost-button sm" data-merge-product-id="${product.id}">합치기</button>` : '';
  return `<div class="row-actions"><button class="edit-button" ${editAttr}>수정</button>${mergeBtn}${restockControl(product)}${deleteButton('products', product.id)}</div>`;
}
function renderProductMergeRow(p) {
  const others = singleProducts().filter((x) => x.id !== p.id);
  const opts = `<option value="">합칠 대상 상품 선택</option>${others.map((x) => `<option value="${x.id}">${escapeHtml(productLabel(x))}</option>`).join('')}`;
  const label = `${escapeHtml(p.name)}${p.option ? ` / ${escapeHtml(p.option)}` : ''}`;
  return `<tr data-product-merge-id="${p.id}"><td colspan="6"><div class="merge-bar"><strong>「${label}」</strong> 를 다음 상품으로 합치기 →<select class="merge-target inline-select">${opts}</select><button class="primary-button" data-merge-run="${p.id}">합치기 실행</button><button class="cancel-button" data-merge-cancel>취소</button><span class="merge-note">이 상품의 입고·판매·비용·조정 기록이 모두 대상 상품으로 옮겨지고, 이 상품은 삭제됩니다.</span></div></td></tr>`;
}
function setComposition(product) {
  return (product.components || []).map((c) => `${productName(c.productId)}${toNum(c.quantity) > 1 ? ` ×${toNum(c.quantity)}` : ''}`).join(' + ');
}
function saleActionButtons(id) { return `<div class="row-actions"><button class="edit-button" data-edit-sale-id="${id}">수정</button>${deleteButton('sales', id)}</div>`; }
function renderProductEditRow(p) {
  return `<tr data-product-edit-id="${p.id}">
    <td>${escapeHtml(p.code)}</td>
    <td><div class="stack-inputs"><input class="inline-input" name="name" value="${escapeHtml(p.name)}" placeholder="상품명" required><input class="inline-input" name="option" value="${escapeHtml(p.option || '')}" placeholder="옵션/색상/사이즈"><input class="inline-input" name="category" list="categoryList" value="${escapeHtml(p.category || '')}" placeholder="분류"></div></td>
    <td><input class="inline-input" name="supplier" value="${escapeHtml(p.supplier || '')}" placeholder="공급처"></td>
    <td><input class="inline-input compact" name="salePrice" type="number" min="0" step="1" value="${toNum(p.salePrice)}"></td>
    <td><input class="inline-input compact" name="reorderLevel" type="number" min="0" step="1" value="${toNum(p.reorderLevel)}"></td>
    <td><div class="row-actions"><button class="primary-button" data-save-product-id="${p.id}">저장</button><button class="cancel-button" data-cancel-product-edit>취소</button></div></td>
  </tr>`;
}
function readInlineProductRow(row) {
  return Object.fromEntries([...row.querySelectorAll('input[name], select[name]')].map((field) => [field.name, field.value]));
}
let editingProductFormId = '';
function componentRowHtml(selectedId = '', qty = 1) {
  return `<div class="component-row"><select class="component-product">${optionsFrom(singleProducts(), selectedId, '부품 선택')}</select><input class="component-qty" type="number" min="1" step="1" value="${toNum(qty) || 1}" aria-label="수량"><button type="button" class="component-remove danger-button">삭제</button></div>`;
}
function addComponentRow(selectedId = '', qty = 1) { $('#componentRows')?.insertAdjacentHTML('beforeend', componentRowHtml(selectedId, qty)); }
function readComponents() {
  return [...$$('#componentRows .component-row')].map((row) => ({
    productId: row.querySelector('.component-product')?.value || '',
    quantity: toNum(row.querySelector('.component-qty')?.value) || 1,
  })).filter((c) => c.productId);
}
function toggleComponentEditor() {
  const isSet = $('#productType')?.value === 'set';
  if ($('#componentEditor')) $('#componentEditor').hidden = !isSet;
  if (isSet && $('#componentRows') && !$('#componentRows').children.length) addComponentRow();
}
function refreshComponentSelects() {
  $$('#componentRows .component-row .component-product').forEach((sel) => { const cur = sel.value; sel.innerHTML = optionsFrom(singleProducts(), cur, '부품 선택'); sel.value = cur; });
}
function resetProductForm() {
  editingProductFormId = '';
  $('#productForm')?.reset();
  if ($('#productType')) $('#productType').value = 'single';
  if ($('#componentRows')) $('#componentRows').innerHTML = '';
  if ($('#componentEditor')) $('#componentEditor').hidden = true;
  if ($('#productSubmit')) $('#productSubmit').textContent = '상품 추가';
  if ($('#productFormTitle')) $('#productFormTitle').textContent = '상품 등록';
  if ($('#cancelProductEdit')) $('#cancelProductEdit').hidden = true;
}
function loadSetIntoForm(product) {
  editingProductFormId = product.id;
  editingProductId = '';
  const form = $('#productForm');
  if ($('#productType')) $('#productType').value = 'set';
  if (form) {
    form.querySelector('[name="name"]').value = product.name || '';
    form.querySelector('[name="category"]').value = product.category || '';
    form.querySelector('[name="option"]').value = product.option || '';
    form.querySelector('[name="supplier"]').value = product.supplier || '';
    form.querySelector('[name="salePrice"]').value = toNum(product.salePrice) || '';
    form.querySelector('[name="reorderLevel"]').value = toNum(product.reorderLevel) || '';
  }
  if ($('#componentRows')) $('#componentRows').innerHTML = '';
  (product.components || []).forEach((c) => addComponentRow(c.productId, c.quantity));
  if (!(product.components || []).length) addComponentRow();
  if ($('#componentEditor')) $('#componentEditor').hidden = false;
  if ($('#productSubmit')) $('#productSubmit').textContent = '세트 수정 저장';
  if ($('#productFormTitle')) $('#productFormTitle').textContent = '세트 수정';
  if ($('#cancelProductEdit')) $('#cancelProductEdit').hidden = false;
  $('#productType')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function submitProductForm(event) {
  event.preventDefault();
  const f = parseForm(event.target);
  const isSet = f.type === 'set';
  const body = { name: f.name, option: f.option, supplier: f.supplier, category: f.category, salePrice: toNum(f.salePrice), reorderLevel: toNum(f.reorderLevel), type: isSet ? 'set' : 'single' };
  if (isSet) {
    body.components = readComponents();
    if (!body.components.length) { alert('세트 부품을 1개 이상 지정해 주세요.'); return; }
  }
  if (!editingProductFormId && !isSet) {
    const dup = state.products.some((p) => p.type !== 'set' && p.name === String(body.name || '').trim() && (p.option || '') === String(body.option || '').trim());
    if (dup && !confirm('같은 이름·옵션의 상품이 이미 있습니다.\n\n같은 상품을 또 들여온 거라면 새로 추가하지 말고, [입고] 화면에서 그 상품을 선택해 날짜·수량만 추가하세요.\n\n그래도 새 상품으로 추가할까요?')) return;
  }
  try {
    const editId = editingProductFormId;
    const next = editId
      ? await api(`/api/products/${editId}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await api('/api/products', { method: 'POST', body: JSON.stringify(body) });
    resetProductForm();
    applyState(next);
  } catch (err) { alert(err.message); }
}
function renderSaleEditRow(s) {
  const fee=Finance.fee(state,s),m=state.finance?.sales?.[s.id]||{};
  return `<tr data-sale-edit-id="${s.id}">
    <td><input class="inline-input compact" name="date" type="date" value="${escapeHtml(s.date)}" required></td>
    <td><input class="inline-input" name="orderNo" value="${escapeHtml(s.orderNo || '')}" placeholder="주문번호"><select name="channel" aria-label="판매처">${financeOptions([['auto','주문 입력으로 판별'],['coupang','쿠팡 12%'],['smartstore','스마트스토어 5%'],['other','기타 0%']],m.channel||'auto')}</select></td>
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
      <input class="inline-input compact" name="platformFee" type="number" min="0" step="1" value="${fee.manual?fee.amount:0}" placeholder="실제 수수료"><select name="feeMode" aria-label="수수료 방식">${financeOptions([['auto','자동 계산'],['manual','실제 정산 금액']],fee.manual?'manual':'auto')}</select>
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
function productFilterOptions(current, list = state.products) {
  return `<option value="">전체 상품</option>${list.map((p) => `<option value="${p.id}" ${String(p.id) === String(current) ? 'selected' : ''}>${escapeHtml(productLabel(p))}</option>`).join('')}`;
}
function fillSaleFilterProduct() { const el = $('#saleFilterProduct'); if (el) el.innerHTML = productFilterOptions(saleFilters.productId); }
function fillPurchaseFilterProduct() { const el = $('#purchaseFilterProduct'); if (el) el.innerHTML = productFilterOptions(purchaseFilters.productId); }

function validDashboardMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4))>=1900; }
function periodRange(period) {
  if(validDashboardMonth(period)) {
    const [year,month]=period.split('-').map(Number);
    const lastDay=new Date(year,month,0).getDate();
    return {from:`${period}-01`,to:`${period}-${lastDay}`};
  }
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (period === 'thisMonth') return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (period === 'lastMonth') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (period === '3months') return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
  return { from: '', to: '' };
}
function periodLabel(period) { if(validDashboardMonth(period))return `${period.slice(0,4)}년 ${Number(period.slice(5))}월`; return { all: '전체', thisMonth: '이번 달', lastMonth: '지난 달', '3months': '최근 3개월' }[period] || '기간'; }
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
function fillCategorySelect(sel, current) {
  if (!sel) return;
  const cats = productCategories();
  const hasUn = state.products.some((p) => !p.category);
  sel.innerHTML = `<option value="">전체 분류</option>${cats.map((c) => `<option value="${escapeHtml(c)}" ${current === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}${hasUn ? `<option value="(미분류)" ${current === '(미분류)' ? 'selected' : ''}>(미분류)</option>` : ''}`;
}
function inventoryMatchesFilter(stat) {
  const p = stat.product;
  if(inventoryFilters.type === 'set' && !stat.isSet) return false;
  if(inventoryFilters.type === 'single' && stat.isSet) return false;
  if (inventoryFilters.category) {
    if (inventoryFilters.category === '(미분류)') { if (p.category) return false; } else if (p.category !== inventoryFilters.category) return false;
  }
  if (inventoryFilters.status === 'low' && !(inventoryAvailability(stat) <= toNum(p.reorderLevel))) return false;
  if (inventoryFilters.status === 'ok' && !(inventoryAvailability(stat) > toNum(p.reorderLevel))) return false;
  if (inventoryFilters.q && !`${p.code} ${p.name} ${p.option || ''} ${p.category || ''}`.toLowerCase().includes(inventoryFilters.q.toLowerCase())) return false;
  return true;
}
function sortByCategory(list, keyFn) {
  return list.slice().sort((a, b) => { const ka = productSortKey(keyFn(a)); const kb = productSortKey(keyFn(b)); return ka[0].localeCompare(kb[0], 'ko') || ka[1].localeCompare(kb[1], 'ko') || ka[2].localeCompare(kb[2]); });
}
function productMatchesFilter(p) {
  if (productFilters.category) {
    if (productFilters.category === '(미분류)') { if (p.category) return false; } else if (p.category !== productFilters.category) return false;
  }
  if (!productFilters.q) return true;
  return `${p.code} ${p.name} ${p.option || ''} ${p.supplier || ''} ${p.category || ''}`.toLowerCase().includes(productFilters.q.toLowerCase());
}
function productCategories() {
  return [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}
function fillProductCategoryControls() {
  const cats = productCategories();
  const sel = $('#productFilterCategory');
  if (sel) {
    const hasUncategorized = state.products.some((p) => !p.category);
    sel.innerHTML = `<option value="">전체 분류</option>${cats.map((c) => `<option value="${escapeHtml(c)}" ${productFilters.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}${hasUncategorized ? `<option value="(미분류)" ${productFilters.category === '(미분류)' ? 'selected' : ''}>(미분류)</option>` : ''}`;
  }
  const list = $('#categoryList');
  if (list) list.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function adjustmentActionButtons(id) { return `<div class="row-actions">${deleteButton('adjustments', id)}</div>`; }
function renderAdjustments() {
  $('#adjustmentCount').textContent = `${state.adjustments.length}건`;
  $('#adjustmentRows').innerHTML = state.adjustments.length ? [...state.adjustments].reverse().map((a) => {
    const count = finishedStocktake(a);
    const inc = toNum(a.delta) >= 0;
    return `<tr><td>${dateFormatter.format(new Date(a.date))}</td><td>${escapeHtml(state.products.find(p => p.id === a.productId) ? productLabel(state.products.find(p => p.id === a.productId)) : '삭제된 상품')}</td><td>${escapeHtml(a.reason)}</td><td class="${inc ? 'money-good' : 'money-bad'}">${count ? '이전 실사 ' : inc ? '+' : '−'}${number(a.quantity)}개${count ? ' (계산 제외)' : ''}</td><td>${escapeHtml(count ? '부품 통합 계산으로 대체됨 · ' + (count.note || '') : a.memo || '-')}</td><td>${adjustmentActionButtons(a.id)}</td></tr>`;
  }).join('') : emptyRow(6);
}

function updateSalePreview() {
  const form = $('#saleForm'); const box = $('#salePreview');
  if (!form || !box) return;
  const f = parseForm(form);
  if (!f.productId || !toNum(f.quantity)) { box.hidden = true; return; }
  const { statsMap } = totals();
  const draft = {
    id:'__preview', productId: String(f.productId), quantity: toNum(f.quantity), salePrice: toNum(f.salePrice),
    discount: toNum(f.discount), shippingIncome: toNum(f.shippingIncome), shippingCost: toNum(f.shippingCost),
    packingCost: toNum(f.packingCost), platformFee: toNum(f.platformFee),
  };
  const previewState={...state,finance:{...state.finance,sales:{...state.finance?.sales,__preview:{channel:f.channel||'auto',feeMode:f.feeMode||'auto',manualFee:toNum(f.platformFee)}}}};
  const r = Finance.saleResult(previewState,draft,statsMap);
  const stat = statsMap[draft.productId];
  const stock = stat ? inventoryAvailability(stat) : 0;
  box.hidden = false;
  box.className = `form-preview ${r.profit < 0 || stock < draft.quantity ? 'bad' : 'good'}`;
  box.innerHTML = `<span>예상 매출 <strong>${money(r.netRevenue)}</strong></span><span>예상 판매이익 <strong>${money(r.profit)}</strong></span><span>판매 후 ${stat?.isSet ? '출고 가능' : '재고'} <strong>${number(stock - draft.quantity)}${stat?.isSet ? '세트' : '개'}</strong></span>`;
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
  const now = validDashboardMonth(dashboardPeriod)?new Date(Number(dashboardPeriod.slice(0,4)),Number(dashboardPeriod.slice(5))-1,1):new Date(); const months = [];
  for (let i = 5; i >= 0; i -= 1) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const chartLabel=$('#chartRangeLabel');if(chartLabel)chartLabel.textContent=`${months[0]} ~ ${months[months.length-1]}`;
  const rev = {}; const prof = {};
  months.forEach((mk) => { rev[mk] = 0; prof[mk] = 0; });
  state.sales.forEach((s) => { const mk = monthKey(s.date); if (mk in rev) { const r = saleResult(s, statsMap); rev[mk] += r.netRevenue; prof[mk] += r.profit; } });
  months.forEach(mk=>{prof[mk]=Finance.report(state,statsMap,mk+'-01',mk+'-31',purchaseTotal).operatingProfit;});
  const maxVal=Math.max(0,...months.map(mk=>rev[mk]),...months.map(mk=>prof[mk]));
  const minVal=Math.min(0,...months.map(mk=>prof[mk]));
  const scale=maxVal-minVal||1,zero=-minVal/scale*100;
  const bars = months.map((mk) => {
    const rH=Math.abs(rev[mk])/scale*100,pH=Math.abs(prof[mk])/scale*100;
    const active = mk === selectedChartMonth ? ' active' : '';
    return `<div class="chart-col${active}" data-month="${mk}" role="button" tabindex="0" title="${Number(mk.slice(5))}월 · 매출 ${money(rev[mk])} · 운영이익 ${money(prof[mk])} (클릭하면 상세)"><div class="chart-bars finance-chart-bars"><div class="finance-zero" style="bottom:${zero}%"></div><div class="bar rev" style="height:${rH}%;bottom:${rev[mk]>=0?zero:zero-rH}%"></div><div class="bar prof ${prof[mk]<0?'negative':''}" style="height:${pH}%;bottom:${prof[mk]>=0?zero:zero-pH}%"></div></div><span class="chart-x">${Number(mk.slice(5))}월</span></div>`;
  }).join('');
  el.innerHTML = `<div class="chart-bars-row">${bars}</div><div id="monthlyDetail" class="chart-detail"></div>`;
  renderMonthlyDetail(selectedChartMonth);
}
function renderMonthlyDetail(mk) {
  const box = $('#monthlyDetail'); if (!box) return;
  if (!mk) { box.innerHTML = '<span class="chart-hint">막대(월)를 클릭하면 그 달의 매출·운영이익과 많이 팔린 상품이 여기에 나옵니다.</span>'; return; }
  const { statsMap } = totals();
  const sales = state.sales.filter((s) => monthKey(s.date) === mk);
  const rev = sales.reduce((a, s) => a + saleResult(s, statsMap).netRevenue, 0);
  const prof = sales.reduce((a, s) => a + saleResult(s, statsMap).profit, 0);
  const map = {};
  sales.forEach((s) => { const r = saleResult(s, statsMap); if (!map[s.productId]) map[s.productId] = { qty: 0, profit: 0 }; map[s.productId].qty += s.quantity; map[s.productId].profit += r.profit; });
  const top = Object.entries(map).sort((a, b) => b[1].qty - a[1].qty).slice(0, 6);
  const detailFinance=Finance.report(state,statsMap,mk+'-01',mk+'-31',purchaseTotal);
  const label = `${Number(mk.slice(5))}월`;
  const rows = top.length ? top.map(([pid, v]) => `<tr><td>${productName(pid)}</td><td>${number(v.qty)}개</td><td class="${v.profit < 0 ? 'money-bad' : ''}">${money(v.profit)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">이 달은 판매가 없습니다.</td></tr>';
  box.innerHTML = `<div class="chart-detail-head"><strong>${label}</strong> · 매출 <strong>${money(rev)}</strong> · 판매이익 <strong>${money(prof)}</strong> · 월 운영이익 <strong>${money(detailFinance.operatingProfit)}</strong> · 판매 ${sales.length}건</div><div class="table-wrap"><table><thead><tr><th>상품</th><th>수량</th><th>순이익</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderBestseller(period) {
  const { statsMap } = totals();
  const { from, to } = recentThirtyDays();
  const map = {};
  state.sales.forEach((s) => {
    if (!inRange(s.date, from, to)) return;
    const r = saleResult(s, statsMap);
    if (!map[s.productId]) map[s.productId] = { productId: s.productId, qty: 0, revenue: 0, profit: 0 };
    map[s.productId].qty += s.quantity; map[s.productId].revenue += r.netRevenue; map[s.productId].profit += r.profit;
  });
  const rows = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
  $('#bestsellerPeriod').textContent = '최근 30일';
  $('#bestsellerRows').innerHTML = rows.length ? rows.map((r) => `<tr><td>${productName(r.productId)}</td><td>${number(r.qty)}개</td><td class="${r.profit < 0 ? 'money-bad' : ''}">${money(r.profit)}</td></tr>`).join('') : emptyRow(3, '최근 30일 판매가 없습니다.');
}
function recentThirtyDays() {
  const now=new Date(), start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-29);
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return {from:iso(start),to:iso(now)};
}
function restockControl(product) {
  const current=product.restockStatus || 'active';
  return `<select class="restock-control" data-restock-id="${product.id}" aria-label="${escapeHtml(productLabel(product))} 재입고 설정">${[['active','계속 판매'],['hold','재입고 보류'],['discontinued','재입고 안 함']].map(([value,label])=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`).join('')}</select>`;
}
function dashboardGroups(stats) {
  const {from,to}=recentThirtyDays();
  return DashboardInventory.classify(stats,state.sales,from,to);
}
function renderDashboardFocus(stats) {
  const groups=dashboardGroups(stats),rows=groups[dashboardFocusTab];
  $('#metricRestock').textContent=`${groups.restock.length}종`;
  $('#restockTabCount').textContent=groups.restock.length;
  $('#anomalyTabCount').textContent=groups.anomalies.length;
  $('#excludedTabCount').textContent=groups.excluded.length;
  const hints={restock:'품절 우선, 최근 30일 판매순입니다. 여러 세트가 공유하는 부품은 한 번만 표시합니다.',anomalies:'마이너스 재고는 실물과 입출고 내역을 확인하세요. 재입고 제외 여부와 관계없이 표시합니다.',excluded:'보류·제외한 상품도 재고와 판매 기록은 유지됩니다. 계속 판매로 변경하면 경고에 다시 포함됩니다.'};
  $('#dashboardFocusHint').textContent=hints[dashboardFocusTab];
  $('#dashboardFocusCount').textContent=`${rows.length}종`;
  const tabs=$$('.dashboard-tabs [data-dashboard-tab]');
  tabs.forEach(tab=>{const selected=tab.dataset.dashboardTab===dashboardFocusTab;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  $('#dashboardFocusPanel').setAttribute('aria-labelledby',`tab-${dashboardFocusTab}`);
  const shown=dashboardExpanded?rows:rows.slice(0,5);
  $('#dashboardFocusRows').innerHTML=shown.length?shown.map((r,index)=>{
    const anomaly=dashboardFocusTab==='anomalies',excluded=dashboardFocusTab==='excluded';
    const affected=(r.affectedSets || []).map(p=>p.name).join(', ');
    const label=anomaly?'장부 확인':excluded?(r.product.restockStatus==='hold'?'보류':'재입고 제외'):r.stock===0?'품절':'수량 부족';
    const detail=excluded?'재입고 경고 제외':anomaly?'입고·판매·실사 보정 내역 확인':`재주문 기준 ${number(r.threshold)}개 이하`;
    const amount=r.isSet?`${number(r.buildable)}세트`:`${number(r.stock)}개`;
    return `<article class="attention-row ${anomaly?'attention-error':excluded?'attention-muted':r.stock===0?'attention-urgent':'attention-low'}"><span class="attention-rank">${index+1}</span><div class="attention-info"><span class="attention-state">${label}</span><strong>${escapeHtml(productName(r.product.id))}</strong><small>${escapeHtml(r.product.code)} · ${detail}</small>${affected?`<small title="${escapeHtml(affected)}">연결 세트 ${r.affectedSets.length}종 · ${escapeHtml(affected)}</small>`:''}</div><div class="attention-stock"><strong>${amount}</strong><small>${r.isSet?'출고 가능':'현재 재고'}</small></div><div class="attention-actions"><button type="button" class="ghost-button" data-open-inventory="${r.product.id}">${anomaly?'장부 확인':'재고 확인'}</button>${restockControl(r.product)}</div></article>`;
  }).join(''):`<div class="dashboard-empty">${dashboardFocusTab==='restock'?'현재 재입고가 필요한 상품이 없습니다.':dashboardFocusTab==='anomalies'?'마이너스 재고가 없습니다.':'보류·제외한 상품이 없습니다. 상품 목록에서도 재입고 여부를 설정할 수 있습니다.'}</div>`;
  $('#dashboardListSummary').textContent=rows.length?`${rows.length}종 중 ${shown.length}종 표시`:'현재 장부 기준';
  $('#dashboardShowAll').hidden=rows.length<=5;
  $('#dashboardShowAll').textContent=dashboardExpanded?'간단히 보기':'전체 보기';
  const count=groups.restock.length+groups.anomalies.length;
  const badge=$('#navLowStock');if(badge){badge.textContent=count;badge.hidden=count===0;}
}
function renderDashboard() {
  const sum = totals();
  const { statsMap } = sum;
  const { from, to } = periodRange(dashboardPeriod);
  const periodSales = state.sales.filter((s) => inRange(s.date, from, to));
  const pRevenue = periodSales.reduce((acc, s) => acc + saleResult(s, statsMap).netRevenue, 0);
  const pProfit = periodSales.reduce((acc, s) => acc + saleResult(s, statsMap).profit, 0);
  renderFinanceSummary(Finance.report(state,statsMap,from,to,purchaseTotal));
  $('#metricInvestment').textContent = money(sum.investment);
  $('#metricInventoryValue').textContent = money(sum.inventoryValue);
  $('#metricRevenue').textContent = money(pRevenue);
  $('#metricProfit').textContent = money(pProfit);
  $('#metricQuantity').textContent = `${number(periodSales.reduce((n,s)=>n+s.quantity,0))}개`;
  renderDashboardFocus(sum.stats);
  const label = periodLabel(dashboardPeriod);
  $('#metricRevenueLabel').textContent = `${label} 매출`;
  $('#metricProfitLabel').textContent = `${label} 판매이익`;
  $('#metricQuantityLabel').textContent = `${label} 판매 수량`;
  $$('#periodBar .chip').forEach((c) => c.classList.toggle('active', c.dataset.period === dashboardPeriod));
  renderMonthlyChart();
  const picker=$('#dashboardMonth');
  if(picker){picker.value=validDashboardMonth(dashboardPeriod)?dashboardPeriod:'';picker.closest('label').classList.toggle('active',validDashboardMonth(dashboardPeriod));}
  const periodText=$('#dashboardPeriodText');if(periodText)periodText.textContent=from&&to?`${from} ~ ${to} 집계`:'전체 기록 집계';
  renderBestseller(dashboardPeriod);
}
function productSortKey(p) { return [p.category ? p.category : '￿￿', p.name || '', p.code || '']; }
function updateBulkBar(list) {
  const cnt = $('#bulkCount'); if (cnt) cnt.textContent = `선택 ${selectedProductIds.size}개`;
  const all = $('#productSelectAll'); if (all) { const ids = list.map((p) => p.id); all.checked = ids.length > 0 && ids.every((id) => selectedProductIds.has(id)); }
  const apply = $('#bulkApply'); if (apply) apply.disabled = selectedProductIds.size === 0;
}
function renderProducts() {
  fillProductCategoryControls();
  const list = state.products.filter((p) => productMatchesFilter(p) || String(p.id) === String(editingProductId) || String(p.id) === String(mergingProductId));
  list.sort((a, b) => { const ka = productSortKey(a); const kb = productSortKey(b); return ka[0].localeCompare(kb[0], 'ko') || ka[1].localeCompare(kb[1], 'ko') || ka[2].localeCompare(kb[2]); });
  $('#productCount').textContent = list.length !== state.products.length ? `${list.length}개 / 전체 ${state.products.length}개` : `${state.products.length}개`;
  $('#productRows').innerHTML = list.length ? list.map((p) => {
    if (String(p.id) === String(mergingProductId) && p.type !== 'set') return renderProductMergeRow(p);
    if (String(p.id) === String(editingProductId) && p.type !== 'set') return renderProductEditRow(p);
    const sub = p.type === 'set' ? (escapeHtml(setComposition(p)) || '<span class="empty-hint">부품 미지정</span>') : escapeHtml(p.option || '-');
    const catTag = p.category ? ` <span class="mini-tag cat">${escapeHtml(p.category)}</span>` : '';
    const setTag = p.type === 'set' ? ' <span class="mini-tag">세트</span>' : '';
    const checked = selectedProductIds.has(p.id) ? 'checked' : '';
    return `<tr><td><label class="row-check"><input type="checkbox" class="product-check" data-id="${p.id}" ${checked}>${p.code}</label></td><td><strong>${escapeHtml(p.name)}${catTag}${setTag}</strong><small>${sub}</small></td><td>${escapeHtml(p.supplier || '-')}</td><td>${money(p.salePrice)}</td><td>${number(p.reorderLevel)}개</td><td>${productActionButtons(p)}</td></tr>`;
  }).join('') : emptyRow(6, state.products.length ? '조건에 맞는 상품이 없습니다.' : '아직 입력된 내용이 없습니다.');
  updateBulkBar(list);
}
function shortDate(d) { const parts = String(d).split('-'); return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : d; }
function summaryRecords() {
  const byProduct = new Map();
  state.purchases.forEach((p) => { if (!byProduct.has(p.productId)) byProduct.set(p.productId, []); byProduct.get(p.productId).push(p); });
  const rows = state.products.filter((p) => byProduct.has(p.id)).map((product) => {
    const items = byProduct.get(product.id).slice().sort((a, b) => a.date.localeCompare(b.date));
    return { product, items, quantity: items.reduce((sum, item) => sum + toNum(item.quantity), 0), count: items.length };
  }).filter(({product: p}) => (!summaryFilters.category || (summaryFilters.category === '(미분류)' ? !p.category : p.category === summaryFilters.category)) && `${p.code} ${p.name} ${p.option || ''}`.toLowerCase().includes(summaryFilters.q.trim().toLowerCase()));
  return sortMetricRows(rows, summaryFilters.sort);
}
function sortMetricRows(rows, sort) {
  const base = sortByCategory(rows, row => row.product);
  if (sort === 'category') return base;
  if (sort === 'name') return base.sort((a, b) => a.product.name.localeCompare(b.product.name, 'ko'));
  const [field, direction] = sort.split('-');
  const fields = ['quantity', 'count', 'stock', 'purchasedQty', 'soldQty', 'margin', 'marginRate', 'inventoryValue', 'buildable', 'gripStock'];
  if (!fields.includes(field) || !['asc', 'desc'].includes(direction)) return base;
  return base.sort((a, b) => (toNum(a[field]) - toNum(b[field])) * (direction === 'asc' ? 1 : -1));
}
function sortedInventory() { return sortMetricRows(totals().stats.filter(inventoryMatchesFilter), inventorySort); }
function renderPurchaseSummary() {
  const el = $('#purchaseSummaryRows');
  if (!el) return;
  fillCategorySelect($('#summaryCategory'), summaryFilters.category);
  const records = summaryRecords();
  el.innerHTML = records.length ? records.map(({product: pr, items, quantity}) => {
    const chips = items.map((x) => `<span class="date-chip">${shortDate(x.date)} · ${number(x.quantity)}개</span>`).join('');
    const catTag = (pr.category ? ` <span class="mini-tag cat">${escapeHtml(pr.category)}</span>` : '') + (pr.type === 'set' ? ' <span class="mini-tag">완제품 입고 · 부품에 합산</span>' : ' <span class="mini-tag">부품 입고</span>');
    return `<tr><td><strong>${escapeHtml(pr.name)}${catTag}</strong><small>${escapeHtml(pr.option || '-')}</small></td><td><strong>${number(quantity)}개</strong></td><td>${items.length}회</td><td><div class="date-chips">${chips}</div></td></tr>`;
  }).join('') : emptyRow(4, state.purchases.length ? '조건에 맞는 입고 내역이 없습니다.' : '아직 입고 내역이 없습니다.');
}
function renderPurchases() {
  fillPurchaseFilterProduct();
  renderPurchaseSummary();
  const list = state.purchases.filter((p) => purchaseMatchesFilter(p) || String(p.id) === String(editingPurchaseId));
  $('#purchaseCount').textContent = list.length !== state.purchases.length ? `${list.length}건 / 전체 ${state.purchases.length}건` : `${state.purchases.length}건`;
  $('#purchaseRows').innerHTML = list.length ? list.map((p) => {
    if (String(p.id) === String(editingPurchaseId)) return renderPurchaseEditRow(p);
    return `<tr><td>${dateFormatter.format(new Date(p.date))}</td><td>${escapeHtml(productLabel(state.products.find(x => x.id === p.productId)))}</td><td>${purchaseSupplier(p) || '-'}</td><td>${number(p.quantity)}개</td><td>${p.currency} ${number(p.unitPrice)}</td><td>${money(p.shipping)}</td><td>${p.memo || '-'}</td><td>${money(purchaseTotal(p))}</td><td>${purchaseActionButtons(p.id)}</td></tr>`;
  }).join('') : emptyRow(9, state.purchases.length ? '조건에 맞는 입고 내역이 없습니다.' : '아직 입력된 내용이 없습니다.');
}
function renderCosts() {
  const labels = { allQty: '수량 기준', allValue: '매입금액 기준', product: '특정 상품', business: '공통비' };
  const list = state.costs.filter((c) => costMatchesFilter(c) || String(c.id) === String(editingCostId));
  $('#costCount').textContent = list.length !== state.costs.length ? `${list.length}건 / 전체 ${state.costs.length}건` : `${state.costs.length}건`;
  $('#costRows').innerHTML = list.length ? list.map((c) => {
    if (String(c.id) === String(editingCostId)) return renderCostEditRow(c);
    return `<tr><td>${dateFormatter.format(new Date(c.date))}</td><td><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.memo || '-')}</small></td><td>${escapeHtml(c.category)}</td><td>${({shipping:'월 택배비',operating:'월 운영비',packaging:'포장재 구매 · 사용량 차감',inventory:'상품 확보 원가'})[Finance.costInfo(state,c).kind]}<small>${Finance.costInfo(state,c).month}${Finance.costInfo(state,c).kind==='inventory'?' · '+labels[c.allocation]:''}</small></td><td>${money(c.amount)}</td><td>${costActionButtons(c.id)}</td></tr>`;
  }).join('') : emptyRow(6, state.costs.length ? '조건에 맞는 비용 내역이 없습니다.' : '아직 입력된 내용이 없습니다.');
}
function renderSales() {
  const { statsMap } = totals();
  fillSaleFilterProduct();
  const signature = JSON.stringify(saleFilters);
  if (signature !== salesFilterSignature) { salesPage = 1; salesFilterSignature = signature; }
  const filtered = state.sales.filter(saleMatchesFilter).reverse().sort((a, b) => b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(filtered.length / salesPageSize));
  salesPage = Math.max(1, Math.min(salesPage, pages));
  const start = (salesPage - 1) * salesPageSize;
  const isFiltered = filtered.length !== state.sales.length;
  $('#saleCount').textContent = isFiltered ? `${filtered.length}건 / 전체 ${state.sales.length}건` : `${state.sales.length}건`;
  $('#salesCount').textContent = `${state.sales.length}건`;
  $('#saleRows').innerHTML = filtered.length ? filtered.slice(start, start + salesPageSize).map((s) => {
    if (String(s.id) === String(editingSaleId)) return renderSaleEditRow(s);
    const r = saleResult(s, statsMap);
    return `<tr><td>${dateFormatter.format(new Date(s.date))}</td><td>${escapeHtml(s.orderNo || '-')}</td><td>${productName(s.productId)}</td><td>${number(s.quantity)}개</td><td>${money(r.netRevenue)}</td><td class="${r.profit < 0 ? 'money-bad' : ''}">${money(r.profit)}<small>수수료 ${money(r.fee)}${r.feeInfo.unknown?' · 판매처 미확인':''}</small></td><td>${saleActionButtons(s.id)}</td></tr>`;
  }).join('') : emptyRow(7, state.sales.length ? '조건에 맞는 판매 내역이 없습니다.' : '아직 입력된 내용이 없습니다.');
  $$('.sales-pagination').forEach((nav) => {
    nav.innerHTML = `<span role="status">총 ${number(filtered.length)}건 · ${filtered.length ? start + 1 : 0}–${Math.min(start + salesPageSize, filtered.length)}건 · 최신순</span>
      <label>표시 건수 <select data-sales-page-size aria-label="판매 내역 표시 건수">${[20, 50, 100].map(size => `<option value="${size}" ${size === salesPageSize ? 'selected' : ''}>${size}건</option>`).join('')}</select></label>
      <div class="sales-page-buttons"><button type="button" class="ghost-button" data-sales-page="1" ${salesPage === 1 ? 'disabled' : ''}>처음</button>
      <button type="button" class="ghost-button" data-sales-page="${salesPage - 1}" ${salesPage === 1 ? 'disabled' : ''}>이전</button>
      <span>${salesPage} / ${pages} 페이지</span>
      <button type="button" class="ghost-button" data-sales-page="${salesPage + 1}" ${salesPage === pages ? 'disabled' : ''}>다음</button>
      <button type="button" class="ghost-button" data-sales-page="${pages}" ${salesPage === pages ? 'disabled' : ''}>마지막</button></div>`;
  });
  const recent = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $('#recentSalesRows').innerHTML = recent.length ? recent.map((s) => { const r = saleResult(s, statsMap); return `<tr><td>${dateFormatter.format(new Date(s.date))}</td><td>${productName(s.productId)}</td><td>${number(s.quantity)}개</td><td>${money(r.profit)}</td></tr>`; }).join('') : emptyRow(4);
}
function inventoryAvailability(stat) { return stat.isSet ? stat.buildable : stat.stock; }
function inventoryBadge(stat) {
  const badge = stockBadge({...stat, stock:inventoryAvailability(stat)});
  return badge || (stat.isSet && stat.shortage > 0 ? '<span class="stock-badge low">그립·부품 부족</span>' : '');
}
function renderInventory() {
  const { stats } = totals();
  fillCategorySelect($('#invFilterCategory'), inventoryFilters.category);
  const shown = sortMetricRows(stats.filter(inventoryMatchesFilter), inventorySort);
  $('#inventoryRows').innerHTML = shown.length ? shown.map(i => {
    const tag = i.isSet ? ' <span class="mini-tag">세트</span>' : ' <span class="mini-tag">부품</span>';
    const sub = `${escapeHtml(i.product.code)} · ${escapeHtml(i.isSet ? setComposition(i.product) || '부품 미지정' : i.product.option || '-')}`;
    const grip = i.isSet ? i.otherComponents.map(c => `<div>${number(c.stat.stock)}개<small>${escapeHtml(productName(c.productId))}</small></div>`).join('') || '-' : '-';
    const ready = i.isSet ? `${number(i.buildable)}세트${inventoryBadge(i)}${i.shortage ? `<small>키링 대비 그립·부품 ${number(i.shortage)}세트분 부족</small>` : ''}` : '-';
    return `<tr class="${stockRowClass({...i,stock:inventoryAvailability(i)})}"><td><strong>${escapeHtml(i.product.name)}${tag}</strong><small>${sub}</small></td><td>${number(i.purchasedQty)}개${i.isSet ? '<small>키링 기준 누적 입고</small>' : ''}</td><td>${number(i.soldQty)}개${i.isSet ? '<small>세트 판매</small>' : '<small>단품 판매 + 세트 사용</small>'}</td><td><strong>${number(i.isSet ? i.primaryStock : i.stock)}개</strong>${i.isSet ? '<small>연결된 키링의 실제 장부 재고</small>' : stockBadge(i)}</td><td>${grip}</td><td>${ready}</td><td>${money(i.avgCost)}</td><td>${money(i.salePrice)}</td><td class="${i.margin < 0 ? 'money-bad' : ''}">${money(i.margin)}</td><td>${Math.round(i.marginRate*1000)/10}%</td><td>${money(i.inventoryValue)}</td></tr>`;
  }).join('') : emptyRow(11,'조건에 맞는 상품이 없습니다.');

}
function render() { historicalCostCache.clear(); $('#defaultRate').value = state.settings.defaultRate; fillProductSelects(); refreshComponentSelects(); renderDashboard(); renderProducts(); renderPurchases(); renderCosts(); renderSales(); renderAdjustments(); renderInventory(); renderFinanceTools(); updateSalePreview(); }

function bindNavigation() { $$('.nav-button').forEach((button) => button.addEventListener('click', () => { $$('.nav-button').forEach((item) => item.classList.remove('active')); $$('.view').forEach((view) => view.classList.remove('active-view')); button.classList.add('active'); $(`#${button.dataset.view}`).classList.add('active-view'); $('#viewTitle').textContent = (button.childNodes[0]?.textContent || button.textContent).trim(); })); }
function formRequest(form){const body=parseForm(form);if(form.id==='purchaseForm'&&!toNum(body.exchangeRate))body.exchangeRate=currentCnyRate();return body;}
function handleForm(selector, endpoint) { $(selector).addEventListener('submit', async (event) => { event.preventDefault(); try { const next = await api(endpoint, { method: 'POST', body: JSON.stringify(formRequest(event.target)) }); applyState(next); event.target.reset(); if(event.target.id==='saleForm')event.target.querySelector('[name="platformFee"]').disabled=true; const dateInput = event.target.querySelector('input[type="date"]'); if (dateInput) dateInput.value = today(); } catch (err) { alert(err.message); } }); }
function bindForms() { $$('form input[type="date"]').forEach((input) => { input.value = today(); }); $('#productForm')?.addEventListener('submit', submitProductForm); handleForm('#purchaseForm', '/api/purchases'); handleForm('#costForm', '/api/costs'); handleForm('#saleForm', '/api/sales'); handleForm('#adjustmentForm', '/api/adjustments'); }
function seedDemo() { return { settings: { defaultRate: 190 }, products: [{ id: 'P-001', code: 'CK-001', name: '콕링 실버', option: '기본', supplier: '1688', salePrice: 15900, reorderLevel: 20 }, { id: 'P-002', code: 'CK-002', name: '콕링 블랙', option: '무광', supplier: 'Taobao', salePrice: 16900, reorderLevel: 15 }], purchases: [], costs: [], sales: [], adjustments: [] }; }
function download(filename, body, type) { const blob = new Blob([body], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
function bindActions() {
  const feeForm=$('#saleForm'),syncFee=()=>{feeForm.querySelector('[name="platformFee"]').disabled=feeForm.querySelector('[name="feeMode"]').value!=='manual';};
  syncFee();feeForm.querySelector('[name="feeMode"]').addEventListener('change',()=>{syncFee();updateSalePreview();});
  for(const [formId,kind] of [['packagingUsageForm','usage'],['cashEntryForm','cash']]){
    $('#'+formId).addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;try{applyState(await api('/api/finance/'+kind,{method:'POST',body:JSON.stringify(parseForm(form))}));form.reset();form.querySelector('[name="date"]').value=today();}catch(err){alert(err.message);}finally{button.disabled=false;}});
  }
  document.body.addEventListener('click',async event=>{
    const save=event.target.closest('[data-finance-save]');
    if(save){const row=save.closest('[data-finance-row]'),body=Object.fromEntries([...row.querySelectorAll('[name]')].map(x=>[x.name,x.value]));save.disabled=true;try{applyState(await api(`/api/finance/${row.dataset.financeKind}/${row.dataset.financeRow}`,{method:'PATCH',body:JSON.stringify(body)}));}catch(err){alert(err.message);save.disabled=false;}return;}
    const del=event.target.closest('[data-finance-delete]');if(!del)return;if(!confirm('이 입출금 또는 포장재 사용 기록을 삭제할까요?'))return;try{applyState(await api(`/api/finance/${del.dataset.financeKind}/${del.dataset.financeDelete}`,{method:'DELETE'}));}catch(err){alert(err.message);}
  });
  $('#financeSaleFilter').addEventListener('change',renderFinanceTools);
  document.body.addEventListener('change',async event=>{
    const select=event.target.closest('[data-restock-id]');if(!select)return;
    const product=state.products.find(p=>p.id===select.dataset.restockId),previous=product?.restockStatus || 'active';
    select.disabled=true;
    try{applyState(await api(`/api/products/${select.dataset.restockId}/restock`,{method:'PATCH',body:JSON.stringify({status:select.value})}));setStatus('재입고 설정 저장됨','success');}
    catch(err){select.value=previous;select.disabled=false;alert(err.message);}
  });
  document.body.addEventListener('click',event=>{
    const tab=event.target.closest('[data-dashboard-tab]');
    if(tab){dashboardFocusTab=tab.dataset.dashboardTab;dashboardExpanded=false;renderDashboardFocus(totals().stats);return;}
    const open=event.target.closest('[data-open-inventory]');if(!open)return;
    const product=state.products.find(p=>p.id===open.dataset.openInventory);if(!product)return;
    inventoryFilters={type:product.type==='set'?'set':'single',category:'',status:'',q:product.code};
    $('#invFilterType').value=inventoryFilters.type;$('#invFilterCategory').value='';$('#invFilterStatus').value='';$('#invFilterQuery').value=product.code;
    document.querySelector('[data-view="inventory"]').click();renderInventory();
  });
  $('.dashboard-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=$$('.dashboard-tabs [role="tab"]'),current=tabs.indexOf(document.activeElement);if(current<0)return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[next].click();tabs[next].focus();
  });
  $('#dashboardShowAll').addEventListener('click',()=>{dashboardExpanded=!dashboardExpanded;renderDashboardFocus(totals().stats);});
  $('#summaryCategory').addEventListener('change', (event) => { summaryFilters.category = event.target.value; renderPurchaseSummary(); });
  $('#summaryQuery').addEventListener('input', (event) => { summaryFilters.q = event.target.value; renderPurchaseSummary(); });
  $('#summarySort').addEventListener('change', (event) => { summaryFilters.sort = event.target.value; renderPurchaseSummary(); });
  $('#summaryReset').addEventListener('click', () => {
    summaryFilters = { category: '', q: '', sort: 'quantity-desc' };
    $('#summaryCategory').value = ''; $('#summaryQuery').value = ''; $('#summarySort').value = 'quantity-desc';
    renderPurchaseSummary();
  });
  $('#invSort').addEventListener('change', (event) => { inventorySort = event.target.value; renderInventory(); });
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sales-page]');
    if (!button || button.disabled) return;
    editingSaleId = '';
    salesPage = Number(button.dataset.salesPage);
    renderSales();
    document.querySelector('.sales-pagination').scrollIntoView({ block: 'start' });
  });
  document.body.addEventListener('change', (event) => {
    if (!event.target.matches('[data-sales-page-size]')) return;
    const size = Number(event.target.value);
    if (![20, 50, 100].includes(size)) return;
    editingSaleId = '';
    salesPageSize = size;
    salesPage = 1;
    renderSales();
    document.querySelector('.sales-pagination').scrollIntoView({ block: 'start' });
  });


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
    const setBtn = event.target.closest('[data-edit-set-id]');
    if (!setBtn) return;
    const product = state.products.find((p) => p.id === String(setBtn.dataset.editSetId));
    if (product) loadSetIntoForm(product);
  });
  document.body.addEventListener('click', (event) => {
    const mb = event.target.closest('[data-merge-product-id]');
    if (!mb) return;
    mergingProductId = mb.dataset.mergeProductId; editingProductId = ''; renderProducts();
  });
  document.body.addEventListener('click', (event) => {
    if (!event.target.closest('[data-merge-cancel]')) return;
    mergingProductId = ''; renderProducts();
  });
  document.body.addEventListener('click', async (event) => {
    const run = event.target.closest('[data-merge-run]');
    if (!run) return;
    const row = run.closest('[data-product-merge-id]');
    const targetId = row?.querySelector('.merge-target')?.value;
    if (!targetId) { alert('합칠 대상 상품을 선택해 주세요.'); return; }
    const src = state.products.find((p) => p.id === String(run.dataset.mergeRun));
    const tgt = state.products.find((p) => p.id === String(targetId));
    if (!confirm(`「${src ? src.name : ''}」의 모든 입고·판매·비용·조정 기록을 「${tgt ? tgt.name : ''}」(으)로 옮기고, 「${src ? src.name : ''}」은(는) 삭제합니다.\n\n되돌릴 수 없습니다. 진행할까요?`)) return;
    try {
      const next = await api(`/api/products/${run.dataset.mergeRun}/merge`, { method: 'POST', body: JSON.stringify({ targetId }) });
      mergingProductId = ''; applyState(next);
    } catch (err) { alert(err.message); }
  });
  $('#productType')?.addEventListener('change', toggleComponentEditor);
  $('#addComponentRow')?.addEventListener('click', () => addComponentRow());
  $('#cancelProductEdit')?.addEventListener('click', resetProductForm);
  $('#componentRows')?.addEventListener('click', (event) => {
    const rm = event.target.closest('.component-remove');
    if (rm) rm.closest('.component-row')?.remove();
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
  const pc = $('#productFilterCategory');
  if (pc) pc.addEventListener('change', () => { productFilters.category = pc.value; renderProducts(); });
  $('#productFilterReset')?.addEventListener('click', () => { productFilters = { q: '', category: '' }; if (pq) pq.value = ''; if (pc) pc.value = ''; renderProducts(); });
  document.body.addEventListener('change', (event) => {
    const cb = event.target.closest('.product-check');
    if (!cb) return;
    if (cb.checked) selectedProductIds.add(cb.dataset.id); else selectedProductIds.delete(cb.dataset.id);
    renderProducts();
  });
  $('#productSelectAll')?.addEventListener('change', (event) => {
    const list = state.products.filter((p) => productMatchesFilter(p));
    if (event.target.checked) list.forEach((p) => selectedProductIds.add(p.id)); else list.forEach((p) => selectedProductIds.delete(p.id));
    renderProducts();
  });
  $('#bulkClear')?.addEventListener('click', () => { selectedProductIds.clear(); renderProducts(); });
  $('#bulkField')?.addEventListener('change', () => {
    const f = $('#bulkField').value; const v = $('#bulkValue'); if (!v) return;
    if (f === 'salePrice' || f === 'reorderLevel') { v.type = 'number'; v.removeAttribute('list'); v.placeholder = f === 'salePrice' ? '바꿀 판매가' : '바꿀 재주문 수량'; }
    else { v.type = 'text'; v.placeholder = f === 'supplier' ? '바꿀 공급처' : '바꿀 분류'; if (f === 'category') v.setAttribute('list', 'categoryList'); else v.removeAttribute('list'); }
    v.value = '';
  });
  $('#bulkApply')?.addEventListener('click', async () => {
    const field = $('#bulkField')?.value; const value = $('#bulkValue')?.value ?? '';
    const ids = [...selectedProductIds];
    if (!ids.length) { alert('먼저 상품을 선택해 주세요.'); return; }
    if ((field === 'salePrice' || field === 'reorderLevel') && value === '') { alert('바꿀 값을 입력해 주세요.'); return; }
    const labels = { salePrice: '판매가', reorderLevel: '재주문 기준', supplier: '공급처', category: '분류' };
    if (!confirm(`선택한 ${ids.length}개 상품의 ${labels[field]}을(를) "${value || '(비움)'}"(으)로 바꿉니다.\n\n진행할까요?`)) return;
    try {
      const next = await api('/api/products/bulk', { method: 'POST', body: JSON.stringify({ ids, field, value }) });
      selectedProductIds.clear();
      if ($('#bulkValue')) $('#bulkValue').value = '';
      applyState(next);
    } catch (err) { alert(err.message); }
  });
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
  $('#dashboardMonth').addEventListener('change',event=>{
    const value=event.target.value;
    if(!value){dashboardPeriod='thisMonth';selectedChartMonth='';renderDashboard();return;}
    if(!validDashboardMonth(value))return;
    dashboardPeriod=value;selectedChartMonth=value;renderDashboard();
  });
  $$('#periodBar .chip').forEach((btn) => btn.addEventListener('click', () => { dashboardPeriod = btn.dataset.period; selectedChartMonth=''; renderDashboard(); }));
  document.body.addEventListener('click', (event) => {
    const col = event.target.closest('.chart-col[data-month]');
    if (!col) return;
    selectedChartMonth = selectedChartMonth === col.dataset.month ? '' : col.dataset.month;
    renderMonthlyChart();
  });
  const saleForm = $('#saleForm');
  if (saleForm) {
    saleForm.querySelector('select[name="productId"]')?.addEventListener('change', autofillSalePrice);
    saleForm.addEventListener('input', updateSalePreview);
  }
  document.body.addEventListener('click', async (event) => { const button = event.target.closest('[data-delete-type]'); if (!button) return; if (!confirm('이 기록을 삭제할까요?')) return; try { applyState(await api(`/api/${button.dataset.deleteType}/${button.dataset.deleteId}`, { method: 'DELETE' })); } catch (err) { alert(err.message); } });
  $('#resetDemo').addEventListener('click', async () => { if (!confirm('현재 클라우드 데이터를 샘플 데이터로 전부 바꿀까요?')) return; try { applyState(await api('/api/import', { method: 'PUT', body: JSON.stringify(seedDemo()) })); } catch (err) { alert(err.message); } });
  $('#exportJson').addEventListener('click', () => download(`kokring-inventory-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('#importJson').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; if (!confirm('현재 클라우드 데이터를 이 백업 파일로 교체할까요?')) { event.target.value = ''; return; } try { applyState(await api('/api/import', { method: 'PUT', body: await file.text() })); } catch (err) { alert(err.message); } finally { event.target.value = ''; } });
  $('#downloadCsv').addEventListener('click', () => { const rows = [['상품코드', '상품명', '분류', '입고', '판매', '키링/부품재고', '그립/기타부품재고', '출고가능세트', '평균원가', '판매가', '예상마진', '마진율', '재고금액'], ...sortedInventory().map((item) => [item.product.code, productName(item.product.id), item.product.category || '', item.purchasedQty, item.soldQty, item.isSet ? item.primaryStock : item.stock, item.isSet ? item.otherComponents.map(c=>productName(c.productId)+':'+c.stat.stock).join(' / ') : '', item.isSet ? item.buildable : '', Math.round(item.avgCost), item.salePrice, Math.round(item.margin), `${Math.round(item.marginRate * 1000) / 10}%`, Math.round(item.inventoryValue)])]; download(`kokring-inventory-${today()}.csv`, `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`, 'text/csv;charset=utf-8'); });
  $('#invFilterType').addEventListener('change', event => {inventoryFilters.type=event.target.value;renderInventory();});
  $('#invFilterCategory')?.addEventListener('change', () => { inventoryFilters.category = $('#invFilterCategory').value; renderInventory(); });
  $('#invFilterStatus')?.addEventListener('change', () => { inventoryFilters.status = $('#invFilterStatus').value; renderInventory(); });
  const invq = $('#invFilterQuery');
  if (invq) invq.addEventListener('input', () => { inventoryFilters.q = invq.value; renderInventory(); });
  $('#invFilterReset')?.addEventListener('click', () => { inventoryFilters = { type:'set', category: '', status: '', q: '' }; $('#invFilterType').value='set'; inventorySort = 'category'; $('#invSort').value = 'category'; if ($('#invFilterCategory')) $('#invFilterCategory').value = ''; if ($('#invFilterStatus')) $('#invFilterStatus').value = ''; if (invq) invq.value = ''; renderInventory(); });
}
function connectEvents() { if (eventSource) eventSource.close(); eventSource = new EventSource('/events'); eventSource.addEventListener('change', () => loadRemote(false)); }
async function init() { setStatus('클라우드 연결 중'); try { await ensureAccess(); await loadRemote(true); connectEvents(); setInterval(() => loadRemote(false), 15000); bindNavigation(); bindForms(); bindActions(); } catch (err) { setStatus('접속 비밀번호 확인 필요', 'error'); alert(err.message); } }
init();
