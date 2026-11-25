(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Finance=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const n=x=>Number(x)||0,inside=(d,from,to)=>!!d&&(!from||d>=from)&&(!to||d<=to),meta=(s,k,id)=>s.finance?.[k]?.[id]||{};
 const rates={coupang:.12,smartstore:.05,other:0};
 function channel(sale,m={}){if(m.channel&&m.channel!=='auto')return m.channel;if(/쿠팡/.test(sale.orderNo||''))return 'coupang';if(/스마트스토어/.test(sale.orderNo||''))return 'smartstore';return 'unknown';}
 function costInfo(s,c){const m=meta(s,'costs',c.id);let kind=m.kind;if(!kind||kind==='auto'){kind=/광고|체험단|스탬프|사은품/.test(c.name)?'operating':/택배비/.test(c.name)?'shipping':/물류비|관세|수입운임/.test(c.name)?'inventory':/스티커|행택|박스|파우치|폴리백|유산지|코팅지|포장지|페이퍼/.test(c.name)?'packaging':'operating';}
  let month=m.month||String(c.date).slice(0,7);if(!m.month&&kind==='shipping'){const match=(c.name||'').match(/(\d{1,2})월/);if(match){const cm=Number(match[1]),year=Number(String(c.date).slice(0,4))-(cm>Number(String(c.date).slice(5,7))?1:0);if(cm>=1&&cm<=12)month=`${year}-${String(cm).padStart(2,'0')}`;}}
  const q=(c.memo||'').match(/(\d+)\s*(개|매)/);return {...m,kind,month,quantity:n(m.quantity)||(q?n(q[1]):0)};
 }
 function fee(s,sale){const m=meta(s,'sales',sale.id),ch=channel(sale,m),base=Math.max(0,n(sale.quantity)*n(sale.salePrice)-n(sale.discount)+n(sale.shippingIncome));const manual=m.feeMode==='manual'||(!m.feeMode&&n(sale.platformFee)>0);return {amount:manual?n(m.manualFee??sale.platformFee):Math.round(base*(rates[ch]||0)),channel:ch,manual,unknown:ch==='unknown'&&!manual,base};}
 function saleResult(s,sale,statsMap){const f=fee(s,sale),netRevenue=n(sale.quantity)*n(sale.salePrice)-n(sale.discount)+n(sale.shippingIncome),cogs=statsMap._saleCosts&&Object.prototype.hasOwnProperty.call(statsMap._saleCosts,sale.id)?n(statsMap._saleCosts[sale.id]):n(sale.quantity)*n(statsMap[sale.productId]?.avgCost);return {netRevenue,cogs,fee:f.amount,feeInfo:f,profit:netRevenue-cogs-f.amount};}
 function packaging(s){const uses=Object.entries(s.finance?.usage||{}).map(([id,u])=>({id,...u}));return s.costs.filter(c=>costInfo(s,c).kind==='packaging').map(c=>{const info=costInfo(s,c),rows=uses.filter(u=>u.costId===c.id),used=rows.reduce((a,u)=>a+n(u.quantity),0);return {cost:c,...info,used,remaining:info.quantity?info.quantity-used:null,unitCost:info.quantity?n(c.amount)/info.quantity:0,rows};});}
 function report(s,statsMap,from='',to='',purchaseTotal=()=>0){
  const sales=s.sales.filter(x=>inside(x.date,from,to)),results=sales.map(x=>saleResult(s,x,statsMap));
  // Every cost is expensed in full on its entered date, independent of legacy metadata.
  const operatingCosts=s.costs.filter(c=>inside(c.date,from,to)).map(c=>({...c,month:String(c.date).slice(0,7)}));
  const operating=operatingCosts.reduce((a,c)=>a+n(c.amount),0),salesProfit=results.reduce((a,r)=>a+r.profit,0);
  // Cost purchases are already fully deducted above: never deduct usage or sale-level legacy expenses again.
  const netProfit=salesProfit-operating;
  const cash=Object.values(s.finance?.cash||{}).filter(c=>inside(c.date,from,to));
  const cashIn=cash.filter(c=>c.direction==='in').reduce((a,c)=>a+n(c.amount),0),cashOut=cash.filter(c=>c.direction==='out').reduce((a,c)=>a+n(c.amount),0);
  const warnings=[];const unknown=results.filter(r=>r.feeInfo.unknown).length;if(unknown)warnings.push(`판매처·수수료 미확인 ${unknown}건`);
  const noCost=results.filter(r=>r.cogs===0).length;if(noCost)warnings.push(`판매 당시 원가 미확인 ${noCost}건`);
  return {revenue:results.reduce((a,r)=>a+r.netRevenue,0),cogs:results.reduce((a,r)=>a+r.cogs,0),fees:results.reduce((a,r)=>a+r.fee,0),salesProfit,shipping:0,packing:0,operating,operatingCosts,netProfit,operatingProfit:netProfit,cashIn,cashOut,cashNet:cashIn-cashOut,cashCount:cash.length,recordedSpending:s.purchases.filter(p=>inside(p.date,from,to)).reduce((a,p)=>a+purchaseTotal(p),0)+operating,warnings};
 }
 return {rates,channel,costInfo,fee,saleResult,packaging,report};
});
