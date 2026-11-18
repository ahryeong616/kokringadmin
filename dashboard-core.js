(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.DashboardInventory=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const active=p=>!p.restockStatus || p.restockStatus==='active';
  function classify(stats,sales,recentFrom,recentTo){
    const byId=Object.fromEntries(stats.map(s=>[s.product.id,s]));
    const sets=stats.filter(s=>s.isSet);
    const recent={};
    sales.filter(s=>(!recentFrom||s.date>=recentFrom)&&(!recentTo||s.date<=recentTo)).forEach(s=>{
      recent[s.productId]=(recent[s.productId]||0)+Number(s.quantity||0);
    });
    const candidates=new Map();
    function add(part,threshold){
      if(!part || part.stock<0 || !active(part.product)) return;
      const parents=sets.filter(s=>(s.product.components||[]).some(c=>c.productId===part.product.id));
      const standaloneSales=sales.some(s=>s.productId===part.product.id && Number(s.quantity)>0);
      if(parents.length && !parents.some(s=>active(s.product)) && !standaloneSales) return;
      const existing=candidates.get(part.product.id);
      if(existing){existing.threshold=Math.max(existing.threshold,threshold);return;}
      const affected=sets.filter(s=>active(s.product)&&(s.product.components||[]).some(c=>c.productId===part.product.id));
      candidates.set(part.product.id,{...part,threshold,affectedSets:affected.map(s=>s.product),recentUnits:(recent[part.product.id]||0)+affected.reduce((n,s)=>n+(recent[s.product.id]||0),0)});
    }
    stats.filter(s=>!s.isSet && s.stock>=0 && s.stock<=Number(s.product.reorderLevel||0)).forEach(s=>add(s,Number(s.product.reorderLevel||0)));
    sets.filter(s=>active(s.product) && s.buildable<=Number(s.product.reorderLevel||0)).forEach(s=>{
      (s.product.components||[]).forEach(c=>{
        const part=byId[c.productId],qty=Number(c.quantity);
        if(part && qty>0 && Math.floor(Math.max(part.stock,0)/qty)<=Number(s.product.reorderLevel||0)) add(part,(Number(s.product.reorderLevel||0)+1)*qty-1);
      });
    });
    const restock=[...candidates.values()].sort((a,b)=>(a.stock===0?0:1)-(b.stock===0?0:1)||b.recentUnits-a.recentUnits||a.stock-b.stock||String(a.product.code||'').localeCompare(String(b.product.code||'')));
    const anomalies=stats.filter(s=>!s.isSet && s.stock<0).sort((a,b)=>a.stock-b.stock).map(s=>({...s,affectedSets:sets.filter(p=>(p.product.components||[]).some(c=>c.productId===s.product.id)).map(p=>p.product)}));
    const excluded=stats.filter(s=>!active(s.product)).sort((a,b)=>a.product.name.localeCompare(b.product.name,'ko'));
    return {restock,anomalies,excluded};
  }
  return {classify};
});
