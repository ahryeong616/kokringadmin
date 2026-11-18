const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../dashboard-core');
const make=(id,stock,policy='active',reorderLevel=0)=>({product:{id,code:id,name:id,type:'single',reorderLevel,restockStatus:policy},isSet:false,stock});
const set=(id,components,buildable=0,status='active',reorderLevel=0)=>({product:{id,code:id,name:id,type:'set',reorderLevel,restockStatus:status,components:components.map(productId=>({productId,quantity:1}))},isSet:true,stock:0,buildable});
const group=(stats,sales=[])=>core.classify(stats,sales,'2026-10-20','2026-11-18');
test('restock, negative ledger and excluded products are separate; negative excluded remains visible',()=>{
 const g=group([make('zero',0),make('low',2,'active',3),make('negative',-8,'discontinued'),make('stop',0,'discontinued'),make('hold',1,'hold',5)]);
 assert.deepEqual(g.restock.map(s=>s.product.id),['zero','low']);assert.deepEqual(g.anomalies.map(s=>s.product.id),['negative']);assert.equal(g.excluded.length,3);
});
test('a shared component produces one purchase alert across multiple sets',()=>{
 const g=group([make('g',0),make('k',10),make('k2',10),set('s',['g','k']),set('s2',['g','k2'])]);assert.equal(g.restock.length,1);assert.equal(g.restock[0].affectedSets.length,2);
});
test('discontinued sets suppress their unused dedicated components, reactivation restores alert',()=>{
 const items=[make('k',0),make('g',10),set('s',['k','g'],0,'discontinued')];assert.equal(group(items).restock.length,0);items[2].product.restockStatus='active';assert.equal(group(items).restock.length,1);
});
test('shared components remain active for other continuing products and explicit part exclusion wins',()=>{
 const items=[make('g',0),set('old',['g'],0,'discontinued'),set('new',['g'])];assert.equal(group(items).restock.length,1);items[0].product.restockStatus='hold';assert.equal(group(items).restock.length,0);
});
test('zero stock before low stock; current 30-day sales rank within severity; future/old sales ignored',()=>{
 const rows=[make('a',0),make('b',0),make('c',1,'active',2)];const sales=[{productId:'a',date:'2026-01-01',quantity:1000},{productId:'a',date:'2027-01-01',quantity:1000},{productId:'b',date:'2026-11-18',quantity:2},{productId:'c',date:'2026-11-18',quantity:100}];assert.deepEqual(group(rows,sales).restock.map(s=>s.product.id),['b','a','c']);
});
test('set reorder threshold propagates to a limiting component with a zero part threshold',()=>{
 const g=group([make('g',5),make('k',20),set('s',['g','k'],5,'active',9)]);assert.equal(g.restock.length,1);assert.equal(g.restock[0].threshold,9);
});
test('restock API validates enum, writes only policy and replies with synchronized state',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),routes={};let query=[],payload,error;
 const product={id:'1',stock:79,sales:22,restockStatus:'active'};
 const conn={release:()=>{},query:async(sql,args)=>{query.push([sql,args]);product.restockStatus=args[0];}};
 const c=vm.createContext({app:{patch:(r,fn)=>routes[r]=fn},pool:{getConnection:async()=>conn},getActiveProduct:async(_,id)=>id,error:m=>Error(m),broadcast:()=>{},replyState:async()=>{payload={...product}}});
 vm.runInContext(source.slice(source.indexOf("app.patch('/api/products/:id/restock'"),source.indexOf("app.patch('/api/products/:id',")),c);
 await routes['/api/products/:id/restock']({params:{id:'1'},body:{status:'invalid'}},{},e=>error=e);assert(error);assert.equal(query.length,0);
 await routes['/api/products/:id/restock']({params:{id:'1'},body:{status:'discontinued'}},{},e=>{throw e});assert.equal(payload.restockStatus,'discontinued');assert.equal(payload.stock,79);assert.equal(payload.sales,22);assert.equal(query.length,1);assert(query[0][0].startsWith('UPDATE products SET restock_status'));
});
test('dashboard focus renders only five rows, supports full list and preserves separate counts',()=>{
 const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{setAttribute(){},classList:{toggle(){}}});return nodes.get(key)};
 const data={settings:{defaultRate:190},products:[],purchases:[],sales:[],costs:[],adjustments:[]};
 const c=vm.createContext({Intl,Date,ComponentInventory:require('../inventory-core'),DashboardInventory:core,sessionStorage:{getItem:()=>''},document:{querySelector:node,querySelectorAll:()=>[]},data,rows:Array.from({length:7},(_,i)=>make(String(i),0))});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8').replace(/init\(\);\s*$/,''),c);vm.runInContext('Object.assign(state,data);state.products=rows.map(x=>x.product);renderDashboardFocus(rows)',c);
 assert.equal((node('#dashboardFocusRows').innerHTML.match(/<article/g)||[]).length,5);assert.equal(node('#metricRestock').textContent,'7종');vm.runInContext('dashboardExpanded=true;renderDashboardFocus(rows)',c);assert.equal((node('#dashboardFocusRows').innerHTML.match(/<article/g)||[]).length,7);vm.runInContext("dashboardFocusTab='excluded';renderDashboardFocus(rows)",c);assert(node('#dashboardFocusRows').innerHTML.includes('보류·제외한 상품이 없습니다'));
});

test('backup restore preserves restock exclusion instead of resetting to active',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),routes={};let policy;
 const conn={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:async(sql,args)=>{if(sql.startsWith('UPDATE products SET restock_status'))policy=args[0];return {insertId:100}}};
 const c=vm.createContext({app:{put:(r,f)=>routes[r]=f},pool:{getConnection:async()=>conn},number:(x,d=0)=>Number(x)||d,integer:x=>Math.trunc(Number(x)||0),text:x=>String(x??''),dateOnly:x=>x,error:m=>Error(m),broadcast:()=>{},replyState:async()=>{}});
 vm.runInContext(source.slice(source.indexOf("app.put('/api/import'"),source.indexOf('app.use((err, req')),c);
 let error;await routes['/api/import']({body:{settings:{defaultRate:190},products:[{id:'1',code:'P',name:'단종 상품',restockStatus:'discontinued'}],sales:[],purchases:[],costs:[],adjustments:[]}},{},e=>error=e);assert.ifError(error);assert.equal(policy,'discontinued');
});
