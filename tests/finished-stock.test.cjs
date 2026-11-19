const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../inventory-core');
function fixture() {
 return {settings:{defaultRate:190},products:[{id:'k',code:'K',name:'키링',category:'키링',type:'single',salePrice:10},{id:'g',code:'G',name:'면그립',category:'그립',type:'single',salePrice:3},{id:'s',code:'S',name:'세트',type:'set',salePrice:20,components:[{productId:'g',quantity:1},{productId:'k',quantity:1}]}],purchases:[{id:'1',productId:'k',quantity:79,unitPrice:2},{id:'2',productId:'g',quantity:50,unitPrice:1}],sales:[],adjustments:[],costs:[]};
}
const price=p=>p.quantity*p.unitPrice;
const calc=s=>core.calculate(s,price);
const by=(rows,id)=>rows.find(x=>x.product.id===id);
test('keyring stock and dispatchable sets are separate; grip-first composition still selects keyring',()=>{
 const r=calc(fixture());assert.equal(by(r,'s').primaryId,'k');assert.equal(by(r,'s').stock,79);assert.equal(by(r,'s').gripStock,50);assert.equal(by(r,'s').buildable,50);assert.equal(by(r,'s').shortage,29);
});
test('20 newly received keyrings update set row immediately; grip receipt unlocks dispatch',()=>{
 const s=fixture();s.purchases[0].quantity=59;assert.equal(by(calc(s),'s').stock,59);
 s.purchases.push({id:'3',productId:'k',quantity:20,unitPrice:2});assert.equal(by(calc(s),'s').stock,79);assert.equal(by(calc(s),'s').buildable,50);
 s.purchases.push({id:'4',productId:'g',quantity:40,unitPrice:1});assert.equal(by(calc(s),'s').stock,79);assert.equal(by(calc(s),'s').buildable,79);
});
test('one set sale deducts both components once; direct component sale also updates set row',()=>{
 const s=fixture();s.sales.push({id:'1',productId:'s',quantity:1});let r=calc(s);assert.equal(by(r,'k').stock,78);assert.equal(by(r,'g').stock,49);assert.equal(by(r,'s').buildable,49);
 s.sales.push({id:'2',productId:'k',quantity:2});r=calc(s);assert.equal(by(r,'s').stock,76);assert.equal(by(r,'g').stock,49);
});
test('complete emergency receipt expands both components; subsequent sale cancels quantities',()=>{
 const s=fixture();s.purchases.push({id:'3',productId:'s',quantity:2,unitPrice:7});s.sales.push({id:'1',productId:'s',quantity:2});const r=calc(s);assert.equal(by(r,'k').stock,79);assert.equal(by(r,'g').stock,50);
 const value=r.filter(x=>!x.isSet).reduce((n,x)=>n+x.purchaseValue,0);assert.equal(value,s.purchases.reduce((n,p)=>n+price(p),0));assert.equal(by(r,'s').inventoryValue,0);
});
test('set adjustment affects every component, component adjustment propagates to linked set',()=>{
 const s=fixture();s.adjustments.push({productId:'s',delta:-2,reason:'분실'});let r=calc(s);assert.equal(by(r,'k').stock,77);assert.equal(by(r,'g').stock,48);
 s.adjustments.push({productId:'k',delta:1,reason:'실사 보정'});r=calc(s);assert.equal(by(r,'s').stock,78);assert.equal(by(r,'s').buildable,48);
});
test('historical completed-goods stocktake remains audit-only and never freezes receipts',()=>{
 const s=fixture();s.adjustments.push({productId:'s',delta:59,reason:'완제품 실사',memo:JSON.stringify({kind:'finished-stocktake-v1',quantity:59})});const r=calc(s);assert.equal(by(r,'s').stock,79);assert.equal(by(r,'g').stock,50);
});
test('shared grip usage updates all designs without reserving or duplicating its stock',()=>{
 const s=fixture();s.products.push({id:'k2',name:'키링2',type:'single',category:'키링'});s.products.push({id:'s2',name:'세트2',type:'set',components:[{productId:'k2',quantity:1},{productId:'g',quantity:1}]});s.purchases.push({productId:'k2',quantity:10,unitPrice:2});s.sales.push({productId:'s2',quantity:3});const r=calc(s);assert.equal(by(r,'s').stock,79);assert.equal(by(r,'s').gripStock,47);assert.equal(by(r,'s2').stock,7);assert.equal(by(r,'s2').buildable,7);
});
test('multi-unit components, negative stock and incomplete composition stay conservative',()=>{
 const s=fixture();s.products[2].components[1].quantity=2;let r=calc(s);assert.equal(by(r,'s').stock,39);assert.equal(by(r,'s').buildable,39);
 s.sales.push({productId:'s',quantity:50});r=calc(s);assert.equal(by(r,'k').stock,-21);assert.equal(by(r,'s').buildable,0);
 s.products[2].components.push({productId:'missing',quantity:1});assert.equal(by(calc(s),'s').buildable,0);
});
test('allocated expenses conserved and sets do not duplicate inventory value',()=>{
 const s=fixture();s.purchases.push({productId:'s',quantity:2,unitPrice:7});const r=core.calculate(s,price,{k:10,g:5,s:20});assert.equal(r.filter(x=>!x.isSet).reduce((n,x)=>n+x.allocated,0),35);assert.equal(r.filter(x=>!x.isSet).reduce((n,x)=>n+x.inventoryValue,0),s.purchases.reduce((n,p)=>n+price(p),0)+35);
});
test('inventory render displays stock, grip and dispatch separately and sorting/filtering work',()=>{
 const nodes=new Map();const document={querySelector:key=>{if(!nodes.has(key))nodes.set(key,{});return nodes.get(key)},querySelectorAll:()=>[]};const s=fixture();const c=vm.createContext({Finance:require('../finance-core'),Intl,Date,document,ComponentInventory:core,sessionStorage:{getItem:()=>''},data:s});const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8').replace(/init\(\);\s*$/,'');vm.runInContext(source,c);vm.runInContext('Object.assign(state,data);renderInventory()',c);const html=nodes.get('#inventoryRows').innerHTML;assert(html.includes('<strong>79개</strong>'));assert(html.includes('50세트'));assert(html.includes('29세트분 부족'));assert(!html.includes('완제품 실사 기준'));assert.equal(vm.runInContext('inventoryStats()[2].buildable',c),50);
 vm.runInContext("inventoryFilters.q='세트';inventorySort='buildable-desc';renderInventory()",c);assert.equal((nodes.get('#inventoryRows').innerHTML.match(/<tr/g)||[]).length,1);
});
