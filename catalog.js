const storeKey="qinghe-clinic-pharmacy-v1",DAY=86400000;
let data={medicines:[]};try{data=JSON.parse(localStorage.getItem(storeKey))||data}catch{}
const total=m=>(m.batches||[]).reduce((s,b)=>s+b.quantity,0);
const days=b=>Math.ceil((new Date(b.expiryDate+"T23:59:59")-Date.now())/DAY);
const saleable=m=>m.publicVisible===true&&!m.disabled&&total(m)>0&&Number(m.salePrice)>0&&(m.batches||[]).some(b=>b.quantity>0&&days(b)>=0);
const nearestExpiry=m=>(m.batches||[]).filter(b=>b.quantity>0&&days(b)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate))[0];
const stockLabel=m=>{const n=total(m);return n<=m.minStock?"库存较少":"现货供应"};
const expiryLabel=m=>{const b=nearestExpiry(m);if(!b)return"请咨询工作人员";const d=days(b);return d<=90?`最近批次 ${d} 天后到期，购买时请确认`:`在售批次有效期至 ${b.expiryDate}`};
const esc=s=>String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const categories=[...new Set(data.medicines.filter(saleable).map(m=>m.category))];
document.getElementById("catalogCategory").innerHTML='<option value="">全部分类</option>'+categories.map(x=>`<option>${esc(x)}</option>`).join("");
function render(){const q=document.getElementById("catalogSearch").value.trim().toLowerCase(),category=document.getElementById("catalogCategory").value;const items=data.medicines.filter(saleable).filter(m=>(!category||m.category===category)&&(!q||JSON.stringify([m.name,m.category,m.spec,m.manufacturer]).toLowerCase().includes(q)));document.getElementById("catalogCount").textContent=`共 ${items.length} 种可售药品`;document.getElementById("catalogGrid").innerHTML=items.map(m=>`<article class="catalog-card"><div class="catalog-card-top"><div><h3>${esc(m.name)}</h3><span class="category">${esc(m.category)} · ${esc(m.manufacturer||"")}</span></div><span class="risk ${total(m)<=m.minStock?"risk-orange":"risk-green"}">${stockLabel(m)}</span></div><p class="catalog-spec">${esc(m.spec)}</p><div class="catalog-price">￥${Number(m.salePrice).toFixed(2)} <small>/ ${esc(m.unit||"盒")}</small></div><div class="catalog-meta"><span>有效期：${esc(expiryLabel(m))}</span><span>提示：用药前请阅读说明书，并咨询医生或药师。</span></div></article>`).join("")||'<div class="catalog-empty">暂无符合条件的可售药品</div>'}
document.getElementById("catalogSearch").oninput=render;document.getElementById("catalogCategory").onchange=render;
document.getElementById("catalogUpdated").textContent="更新时间："+new Date().toLocaleString("zh-CN");render();
