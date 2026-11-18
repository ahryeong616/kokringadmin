const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').replace(/init\(\);\s*$/, '');
function app(data) {
  const ctx = vm.createContext({Intl, Date, sessionStorage: {getItem: () => ''}, data});
  vm.runInContext(source, ctx);
  vm.runInContext('Object.assign(state,data)',ctx);
  return {run: code => vm.runInContext(code,ctx), get: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`,ctx))};
}
function fixture() {
  return {settings:{defaultRate:190},products:[{id:'1',name:'Bear',type:'single',salePrice:10,components:[]},{id:'2',name:'Grip',type:'single',salePrice:5,components:[]},{id:'3',name:'Set',type:'set',salePrice:20,components:[{productId:'1',quantity:1},{productId:'2',quantity:1}]}],purchases:[{id:'1',date:'2026-11-01',productId:'1',quantity:10,currency:'KRW',unitPrice:2,shipping:0},{id:'2',date:'2026-11-01',productId:'2',quantity:10,currency:'KRW',unitPrice:1,shipping:0},{id:'3',date:'2026-11-09',productId:'3',quantity:2,currency:'KRW',unitPrice:7,shipping:0}],sales:[{id:'1',date:'2026-11-05',productId:'3',quantity:1,salePrice:20,discount:0,shippingIncome:0,shippingCost:0,packingCost:0,platformFee:0},{id:'2',date:'2026-11-10',productId:'3',quantity:3,salePrice:20,discount:0,shippingIncome:0,shippingCost:0,packingCost:0,platformFee:0}],costs:[],adjustments:[]};
}
function count(a,quantity=59) {
  a.run(`state.adjustments.push({id:'1',productId:'3',date:'2026-11-18',reason:'완제품 실사',quantity:${quantity},delta:${quantity},memo:JSON.stringify({kind:'finished-stocktake-v1',quantity:${quantity},soldQty:4,purchasedQty:2,adjustQty:0,saleIds:['1','2'],purchaseIds:['3']})})`);
}
test('finished purchases consumed only after receipt, excess sales consume components once',()=>{
  const a=app(fixture());const stats=a.get('inventoryStats()');
  assert.equal(stats[0].stock,8);assert.equal(stats[1].stock,8);
  assert.equal(stats[2].finishedRemaining,0);assert.equal(stats[2].stock,8);
  assert.equal(stats[2].saleCosts['1'],3);assert.equal(stats[2].saleCosts['2'],17);
  assert.equal(a.get('saleResult(state.sales[1],totals().statsMap).profit'),43);
});
test('unconsumed finished goods count and value without adding components',()=>{
  const f=fixture();f.sales=[];const a=app(f);const stats=a.get('inventoryStats()');
  assert.equal(stats[0].stock,10);assert.equal(stats[2].stock,12);assert.equal(stats[2].inventoryValue,14);
});
test('physical count overrides buildable and subsequent sales do not consume parts again',()=>{
  const a=app(fixture());count(a);assert.equal(a.get('inventoryStats()[2].stock'),59);
  a.run("state.sales.push({...state.sales[0],id:'3',date:'2026-11-19',quantity:1})");
  assert.equal(a.get('inventoryStats()[2].stock'),58);assert.equal(a.get('inventoryStats()[0].stock'),8);
  a.run("state.products[1].components=[];state.adjustments.push({id:'2',productId:'2',delta:-8,reason:'분실'})");
  assert.equal(a.get('inventoryStats()[2].buildable'),0);assert.equal(a.get('inventoryStats()[2].stock'),58);
});
test('new finished purchases and adjustments move physical count with correct sale cost',()=>{
  const a=app(fixture());count(a);
  a.run("state.purchases.push({id:'4',productId:'3',date:'2026-11-19',quantity:2,currency:'KRW',unitPrice:9,shipping:0});state.sales.push({...state.sales[0],id:'3',date:'2026-11-19',quantity:1});state.adjustments.push({id:'2',productId:'3',delta:-1,reason:'分失'})");
  assert.equal(a.get('inventoryStats()[2].stock'),59);assert.equal(a.get('inventoryStats()[0].stock'),8);assert.equal(a.get("inventoryStats()[2].saleCosts['3']"),9);
});
test('zero count and deleting a historical sale do not reconsume parts for newer sales',()=>{
  const a=app(fixture());count(a,0);assert.equal(a.get('inventoryStats()[2].stock'),0);
  a.run("state.sales.push({...state.sales[0],id:'3',date:'2026-11-19',quantity:1});state.sales=state.sales.filter(x=>x.id!=='1')");
  assert.equal(a.get('inventoryStats()[2].stock'),0);assert.equal(a.get('inventoryStats()[0].stock'),9);
});
test('stocktake helper rejects non-set/invalid counts and snapshots existing transactions',async()=>{
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const segment=server.slice(server.indexOf('function parseFinishedStocktake('),server.indexOf('// Correct completed-set purchases'));
  let inserts=[];const data=fixture();
  const ctx=vm.createContext({JSON,Number,parseInt,readState:async()=>data,getProductType:async(_,id)=>id==='3'?'set':'single',text:(x)=>String(x||''),error:m=>new Error(m),conn:{query:async(...args)=>{inserts.push(args)} }});
  vm.runInContext(segment,ctx);
  await assert.rejects(vm.runInContext("saveFinishedStocktake(conn,'1','2026-11-18',59,'test')",ctx));
  await assert.rejects(vm.runInContext("saveFinishedStocktake(conn,'3','2026-11-18',-1,'test')",ctx));
  await vm.runInContext("saveFinishedStocktake(conn,'3','2026-11-18',59,'test')",ctx);
  assert.equal(inserts.length,1);const p=JSON.parse(inserts[0][1][4]);assert.equal(p.soldQty,4);assert.equal(p.purchasedQty,2);assert.deepEqual(p.saleIds,['1','2']);assert.deepEqual(p.purchaseIds,['3']);
});

test('repeated stocktakes preserve historical finished sales without consuming parts again',()=>{
  const a=app(fixture());count(a);
  a.run("state.sales.push({...state.sales[0],id:'3',date:'2026-11-19',quantity:1});state.adjustments.push({id:'2',productId:'3',reason:'완제품 실사',quantity:58,delta:58,memo:JSON.stringify({kind:'finished-stocktake-v1',quantity:58,soldQty:5,purchasedQty:2,adjustQty:0,saleIds:['1','2','3'],purchaseIds:['3']})})");
  assert.equal(a.get('inventoryStats()[2].stock'),58);assert.equal(a.get('inventoryStats()[0].stock'),8);
});

test('reconcile rolls back the entire batch when a later purchase does not match',async()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const routes={};let records={'97':'53','98':'54'},snapshot,rolledBack=false,committed=false,err;
 const conn={beginTransaction:async()=>{snapshot={...records}},rollback:async()=>{records=snapshot;rolledBack=true},commit:async()=>{committed=true},release:()=>{},query:async(sql,params)=>{
   if(sql.startsWith('SELECT product_id, quantity'))return [{product_id:records[params[0]],quantity:2,supplier:'급구'}];
   if(sql.startsWith('SELECT product_id,product_name'))return [{product_id:params[0],product_name:'Bear',product_type:'single'},{product_id:params[1],product_name:'Bear',product_type:'set'}];
   if(sql.startsWith('UPDATE purchases')){records[params[1]]=params[0];return {affectedRows:1};}
   throw Error(sql);
 }};
 const ctx=vm.createContext({app:{post:(route,fn)=>{routes[route]=fn}},pool:{getConnection:async()=>conn},getActiveProduct:async(_,id)=>String(id),error:m=>Error(m),saveFinishedStocktake:async()=>{},dateOnly:x=>x,broadcast:()=>{},replyState:async()=>{}});
 vm.runInContext(server.slice(server.indexOf("app.post('/api/finished-stock/reconcile'"),server.indexOf("app.post('/api/adjustments',")),ctx);
 await routes['/api/finished-stock/reconcile']({body:{purchaseMoves:[{id:'97',fromProductId:'53',toProductId:'56',expectedQuantity:2,expectedSupplier:'급구'},{id:'98',fromProductId:'WRONG',toProductId:'57',expectedQuantity:2,expectedSupplier:'급구'}],stocktakes:[{productId:'56',quantity:59,date:'2026-11-18'}]}},{},e=>{err=e});
 assert(err);assert(rolledBack);assert(!committed);assert.deepEqual(records,{'97':'53','98':'54'});
});

test('backup import remaps stocktake references and preserves a zero physical count',async()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');const routes={};let n=100,record,error;
 const conn={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:async(sql,params)=>{if(sql.startsWith('INSERT INTO adjustments'))record=params;return {insertId:++n}}};
 const ctx=vm.createContext({app:{put:(route,fn)=>{routes[route]=fn}},pool:{getConnection:async()=>conn},text:x=>String(x??''),number:(x,d=0)=>Number(x)||d,integer:x=>Math.trunc(Number(x)||0),dateOnly:x=>x,error:m=>Error(m),broadcast:()=>{},replyState:async()=>{}});
 vm.runInContext(server.slice(server.indexOf('function parseFinishedStocktake('),server.indexOf('async function saveFinishedStocktake(')),ctx);
 vm.runInContext(server.slice(server.indexOf("app.put('/api/import'"),server.indexOf('app.use((err, req')),ctx);
 const f=fixture();f.products.forEach((p,i)=>p.code='T-'+i);f.adjustments=[{id:'1',productId:'3',date:'2026-11-18',reason:'완제품 실사',quantity:0,delta:0,memo:JSON.stringify({kind:'finished-stocktake-v1',quantity:0,soldQty:4,purchasedQty:2,adjustQty:0,saleIds:['1','2'],purchaseIds:['3']})}];
 await routes['/api/import']({body:f},{},err=>{error=err});assert.ifError(error);assert(record);assert.equal(record[2],0);const restored=JSON.parse(record[4]);assert.equal(restored.quantity,0);assert.equal(restored.saleIds.length,2);assert(!restored.saleIds.includes('1'));assert.equal(restored.purchaseIds.length,1);assert.notEqual(restored.purchaseIds[0],'3');
});
