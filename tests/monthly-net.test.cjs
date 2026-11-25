const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Finance=require('../finance-core'),ComponentInventory=require('../inventory-core');
test('inventory-classified costs are expensed once, never included in current or historical COGS',()=>{
 const c=vm.createContext({Finance,ComponentInventory,Date,Intl,sessionStorage:{getItem:()=>''}});
 vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8').replace(/init\(\);\s*$/,''),c);
 vm.runInContext(`Object.assign(state,{products:[{id:'p',name:'상품',type:'single',salePrice:2000}],purchases:[{id:'buy',productId:'p',date:'2026-11-01',currency:'KRW',quantity:100,unitPrice:1000,shipping:1000}],costs:[{id:'freight',date:'2026-11-01',name:'수입운임',amount:20000,allocation:'allQty'}],sales:[{id:'sale',productId:'p',date:'2026-11-02',quantity:1,salePrice:2000,shippingIncome:0,discount:0,platformFee:0}],finance:{costs:{freight:{kind:'inventory',month:'2026-12'}},sales:{sale:{channel:'other'}}}})`,c);
 const r=JSON.parse(vm.runInContext("JSON.stringify(financeReport('2026-11-01','2026-11-30'))",c));
 assert.equal(r.cogs,1010);assert.equal(r.salesProfit,990);assert.equal(r.operating,20000);assert.equal(r.netProfit,-19010);
 assert.equal(vm.runInContext('inventoryStats()[0].avgCost',c),1010);
});
test('date changes and deletions change that month immediately; reports conserve the full expense total',()=>{
 const s={sales:[],purchases:[],costs:[{id:'a',date:'2026-11-24',name:'박스',amount:40700},{id:'b',date:'2026-10-31',name:'9월 택배비',amount:206250}],finance:{costs:{a:{kind:'packaging',month:'2026-09'},b:{kind:'shipping',month:'2026-09'}},usage:{u:{costId:'a',date:'2026-12-02',quantity:10}}}};
 const report=m=>Finance.report(s,{},`${m}-01`,`${m}-31`);
 assert.equal(report('2026-11').netProfit,-40700);assert.equal(report('2026-10').netProfit,-206250);assert.equal(report('2026-09').netProfit,0);
 assert.equal(Finance.report(s,{}).operating,report('2026-11').operating+report('2026-10').operating);
 s.costs[0].date='2026-12-01';assert.equal(report('2026-11').operating,0);assert.equal(report('2026-12').operating,40700);
 s.costs.shift();assert.equal(report('2026-12').operating,0);
});
