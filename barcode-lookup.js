const barcodeLookupInput=document.getElementById("medicineBarcode"),lookupResult=document.getElementById("lookupResult"),medicineEntryForm=document.getElementById("medicineForm");
const demoBarcodeCatalog={
  "6937835110193":{name:"吡罗昔康片",code:"YP-EXT-001",category:"西药",spec:"0.02g",manufacturer:"重庆和平制药有限公司",approvalNo:"国药准字H50020656"},
  "6901234567892":{name:"维生素C片",code:"YP-EXT-002",category:"西药",spec:"100mg × 100片",manufacturer:"示例制药有限公司",approvalNo:"演示数据"}
};
function fillMedicineFromLookup(item,source){
  const set=(name,value)=>{if(value&&medicineEntryForm.elements[name])medicineEntryForm.elements[name].value=value};
  set("name",item.name);set("code",item.code);set("category",item.category);set("spec",item.spec);set("manufacturer",item.manufacturer);
  lookupResult.innerHTML=`<div class="lookup-success"><strong>已匹配：${item.name}</strong><span>${item.manufacturer||""} · ${item.spec||""}</span><small>来源：${source}${item.approvalNo?` · 批准文号：${item.approvalNo}`:""}。保存前请核对包装信息。</small></div>`;
}
async function lookupBarcode(){
  const code=barcodeLookupInput.value.trim();if(!code)return toast("请先扫描或输入条形码");
  lookupResult.innerHTML='<div class="lookup-loading">正在查询药品资料...</div>';
  const local=data.medicines.find(m=>m.barcode===code);
  if(local){fillMedicineFromLookup(local,"诊所已有药品库");return}
  const endpoint=localStorage.getItem("clinic-barcode-api-url");
  if(endpoint){try{const response=await fetch(endpoint.replace("{barcode}",encodeURIComponent(code)));if(response.ok){const body=await response.json(),item=body.data||body.product||body;if(item?.name||item?.药品名称){fillMedicineFromLookup({name:item.name||item.药品名称,code:item.code||item.药品编码||"",category:item.category||item.分类||"西药",spec:item.spec||item.规格||"",manufacturer:item.manufacturer||item.企业名称||"",approvalNo:item.approvalNo||item.批准文号||""},"已授权外部药品数据库");return}}}catch{}}
  if(demoBarcodeCatalog[code]){fillMedicineFromLookup(demoBarcodeCatalog[code],"内置演示药品资料");return}
  lookupResult.innerHTML='<div class="lookup-missing"><strong>暂未匹配到药品资料</strong><span>条码已保留，可手动填写；部署后接入授权药品数据库即可扩大覆盖范围。</span></div>';
}
document.getElementById("lookupBarcode").onclick=lookupBarcode;
barcodeLookupInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();lookupBarcode()}});
barcodeLookupInput.addEventListener("input",()=>{lookupResult.innerHTML=""});
