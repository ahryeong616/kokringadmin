const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Finance=require('../finance-core');
const state=()=>({products:[],purchases:[],sales:[],costs:[
 {id:'ad',date:'2026-11-12',name:'광고비',category:'마케팅',memo:'검색 광고',amount:10000},
 {id:'other',date:'2026-12-03',name:'촬영 소품',amount:20000},
 {id:'shipping',date:'2026-11-02',name:'11월 택배비',amount:30000},
 {id:'pack',date:'2026-11-02',name:'박스',amount:40000},
 {id:'inventory',date:'2026-11-02',name:'수입운임',amount:50000},
 {id:'old',date:'2026-10-02',name:'광고비',amount:60000}
],finance:{costs:{other:{kind:'operating',month:'2026-11'}}}});
test('detail uses the same attribution months and classifications as the operating total',()=>{
 const s=state(),r=Finance.report(s,{},'2026-11-01','2026-11-30');
 assert.deepEqual(r.operatingCosts.map(c=>c.id),['ad','other']);
 assert.equal(r.operatingCosts.reduce((n,c)=>n+Number(c.amount),0),r.operating);
 assert.equal(r.operating,30000);assert.equal(r.operatingCosts[1].date,'2026-12-03');assert.equal(r.operatingCosts[1].month,'2026-11');
 assert.equal(Finance.report(s,{},'2026-12-01','2026-12-31').operatingCosts.length,0);
 assert.equal(Finance.report(s,{}).operatingCosts.length,3);assert.equal(s.costs[1].month,undefined);
});
function ui(){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',innerHTML:'',hidden:true,attrs:{'aria-expanded':'false'},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},addEventListener(k,f){this[k]=f;}});return nodes.get(key);};
 const c=vm.createContext({$:node,money:n=>'₩'+n,escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),emptyRow:(n,m)=>`<tr><td colspan="${n}">${m}</td></tr>`});
 vm.runInContext(fs.readFileSync(require.resolve('../finance-ui.js'),'utf8'),c);
 return {node,render:r=>{c.report=r;vm.runInContext('renderFinanceSummary(report)',c);},bind:()=>vm.runInContext('bindOperatingCosts()',c)};
}
test('click expands/collapses, period changes refresh an open detail, and user text is escaped',()=>{
 const u=ui(),s=state();s.costs[0].memo='<img src=x onerror=alert(1)>';
 u.render(Finance.report(s,{},'2026-11-01','2026-11-30'));u.bind();
 assert.match(u.node('#operatingCostRows').innerHTML,/&lt;img/);assert(!u.node('#operatingCostRows').innerHTML.includes('<img'));
 u.node('#financeOperatingToggle').click();assert.equal(u.node('#operatingCostDetail').hidden,false);assert.equal(u.node('#financeOperatingToggle').attrs['aria-expanded'],'true');
 u.render(Finance.report(s,{},'2026-10-01','2026-10-31'));assert.equal(u.node('#operatingCostSummary').textContent,'1건 · 합계 ₩60000');assert(!u.node('#operatingCostRows').innerHTML.includes('검색 광고'));assert.equal(u.node('#operatingCostDetail').hidden,false);
 u.node('#financeOperatingToggle').click();assert.equal(u.node('#operatingCostDetail').hidden,true);
 u.render(Finance.report(s,{},'2026-12-01','2026-12-31'));assert.match(u.node('#operatingCostRows').innerHTML,/집계된 지출이 없습니다/);
});
