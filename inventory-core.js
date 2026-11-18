(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ComponentInventory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const num = value => Number(value) || 0;
  function legacyCount(row) {
    if (row.reason !== '완제품 실사') return false;
    try { return JSON.parse(row.memo).kind === 'finished-stocktake-v1'; } catch (_) { return false; }
  }
  function calculate(state, purchaseTotal, allocated = {}) {
    const products = Object.fromEntries(state.products.map(p => [p.id, p]));
    const records = Object.fromEntries(state.products.filter(p => p.type !== 'set').map(product => [product.id, {
      product, purchasedQty: 0, purchaseValue: 0, allocated: num(allocated[product.id]),
      directSoldQty: 0, usedInSets: 0, adjustQty: 0,
    }]));
    const components = product => (product.components || []).map(c => ({
      productId: String(c.productId), quantity: num(c.quantity),
    })).filter(c => records[c.productId] && c.quantity > 0);
    // Estimate a complete purchase's component cost shares from standalone costs.
    const weights = {};
    state.purchases.forEach(p => {
      if (!records[p.productId]) return;
      const w = weights[p.productId] || (weights[p.productId] = {quantity: 0, value: 0});
      w.quantity += num(p.quantity); w.value += purchaseTotal(p);
    });
    function shares(product) {
      const parts = components(product);
      const values = parts.map(c => c.quantity * (weights[c.productId]?.quantity ? weights[c.productId].value / weights[c.productId].quantity : 0));
      const total = values.reduce((a,b) => a+b,0);
      const units = parts.reduce((n,c) => n+c.quantity,0);
      return parts.map((c,i) => ({...c, share: total > 0 ? values[i] / total : c.quantity / units}));
    }
    state.purchases.forEach(p => {
      const product = products[p.productId];
      if (!product) return;
      const parts = product.type === 'set' ? shares(product) : [{productId: product.id, quantity: 1, share: 1}];
      parts.forEach(c => {
        const row = records[c.productId];
        row.purchasedQty += num(p.quantity) * c.quantity;
        row.purchaseValue += purchaseTotal(p) * c.share;
      });
    });
    state.products.filter(p => p.type === 'set').forEach(p => {
      shares(p).forEach(c => { records[c.productId].allocated += num(allocated[p.id]) * c.share; });
    });
    state.sales.forEach(sale => {
      const product = products[sale.productId];
      if (!product) return;
      if (product.type === 'set') components(product).forEach(c => { records[c.productId].usedInSets += num(sale.quantity) * c.quantity; });
      else if (records[product.id]) records[product.id].directSoldQty += num(sale.quantity);
    });
    (state.adjustments || []).filter(a => !legacyCount(a)).forEach(a => {
      const product = products[a.productId];
      if (!product) return;
      const parts = product.type === 'set' ? components(product) : [{productId:product.id, quantity:1}];
      parts.forEach(c => { records[c.productId].adjustQty += num(a.delta) * c.quantity; });
    });
    const stats = {};
    Object.values(records).forEach(row => {
      const soldQty = row.directSoldQty + row.usedInSets;
      const stock = row.purchasedQty - soldQty + row.adjustQty;
      const avgCost = row.purchasedQty > 0 ? (row.purchaseValue + row.allocated) / row.purchasedQty : 0;
      const salePrice = num(row.product.salePrice), margin = salePrice - avgCost;
      stats[row.product.id] = {...row, isSet:false, soldQty, stock, avgCost, salePrice, margin,
        marginRate: salePrice > 0 ? margin / salePrice : 0, inventoryValue: Math.max(stock,0) * avgCost};
    });
    state.products.filter(p => p.type === 'set').forEach(product => {
      const parts = components(product).map(c => ({...c, stat:stats[c.productId]}));
      const isGrip = c => c.stat.product.category === '그립' || /그립/.test(c.stat.product.name);
      const primary = parts.find(c => c.stat.product.category === '키링' || /^키링/.test(c.stat.product.name)) || parts.find(c => !isGrip(c)) || parts[0];
      const others = parts.filter(c => c !== primary);
      const capacity = c => Math.floor(Math.max(c.stat.stock,0) / c.quantity);
      const valid = parts.length === (product.components || []).length && parts.length > 0;
      const buildable = valid ? Math.min(...parts.map(capacity)) : 0;
      const stock = primary ? Math.floor(primary.stat.stock / primary.quantity) : 0;
      const avgCost = parts.reduce((n,c) => n + c.stat.avgCost * c.quantity,0);
      const salePrice = num(product.salePrice), margin = salePrice - avgCost;
      stats[product.id] = {product, isSet:true, componentStocks:parts, primaryId:primary?.productId,
        primaryStock:primary?.stat.stock || 0, primaryQuantity:primary?.quantity || 1,
        gripStock:others.length ? Math.min(...others.map(c => c.stat.stock)) : null,
        otherComponents:others, purchasedQty:primary ? primary.stat.purchasedQty / primary.quantity : 0,
        soldQty:state.sales.filter(x => x.productId === product.id).reduce((n,x) => n+num(x.quantity),0),
        usedInSets:0, adjustQty:primary?.stat.adjustQty || 0, stock, buildable,
        shortage:Math.max(0,Math.max(stock,0)-buildable), avgCost, salePrice, margin,
        marginRate:salePrice > 0 ? margin/salePrice : 0, inventoryValue:0};
    });
    return state.products.map(p => stats[p.id]).filter(Boolean);
  }
  return {calculate, legacyCount};
});
