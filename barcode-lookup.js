const medicineEntryForm=document.getElementById("medicineForm"),stockEntryForm=document.getElementById("stockForm");
const medicineBarcodeInput=document.getElementById("medicineBarcode"),stockBarcodeInput=document.getElementById("stockBarcode"),lookupResult=document.getElementById("lookupResult"),stockLookupResult=document.getElementById("stockLookupResult");
const demoBarcodeCatalog={
  "6937835110193":{name:"吡罗昔康片",code:"国药准字H50020656",category:"西药",spec:"0.02g × 100片",unit:"瓶",manufacturer:"重庆和平制药有限公司",minStock:20,salePrice:12.8,approvalNo:"国药准字H50020656"},
  "6901234567892":{name:"维生素C片",code:"国药准字H44020019",category:"西药",spec:"100mg × 100片",unit:"瓶",manufacturer:"示例制药有限公司",minStock:20,salePrice:8.5,approvalNo:"演示数据"},
  "6970000000018":{name:"一次性无菌注射器",code:"械注准示例001",category:"医疗耗材",spec:"5ml × 1支",unit:"支",manufacturer:"示例医疗器械有限公司",minStock:50,salePrice:1.5,approvalNo:"演示器械数据"}
};

function normalizeBarcode(raw){return String(raw||"").trim().replace(/[()]/g,"").replace(/\s+/g,"")}
function compactDate(value){
  if(!value)return"";
  const s=String(value).replace(/\D/g,"");
  if(s.length===8)return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  if(s.length===6){const y=Number(s.slice(0,2)),year=y>=50?1900+y:2000+y,month=s.slice(2,4),day=s.slice(4,6);return `${year}-${month}-${day==="00"?"01":day}`}
  return"";
}
function splitGs1(raw){
  const text=String(raw||"").trim();
  const cleaned=text.replace(/[()]/g,"");
  const groupSep=String.fromCharCode(29);
  const ai={raw:text,barcode:cleaned,gtin:"",batchNo:"",productionDate:"",expiryDate:"",serialNo:"",quantity:""};
  let i=0;
  while(i<cleaned.length){
    const code=cleaned.slice(i,i+2);
    if(code==="01"){ai.gtin=cleaned.slice(i+2,i+16);i+=16;continue}
    if(code==="11"){ai.productionDate=compactDate(cleaned.slice(i+2,i+8));i+=8;continue}
    if(code==="17"){ai.expiryDate=compactDate(cleaned.slice(i+2,i+8));i+=8;continue}
    if(code==="30"){const rest=cleaned.slice(i+2),m=rest.match(/^\d{1,8}/);ai.quantity=m?m[0]:"";i+=2+(m?m[0].length:0);continue}
    if(code==="10"||code==="21"){
      const nextSep=cleaned.indexOf(groupSep,i+2);
      const rest=nextSep>=0?cleaned.slice(i+2,nextSep):cleaned.slice(i+2);
      const nextAi=rest.search(/(?:11|17|30)\d{6}/);
      const value=nextAi>0?rest.slice(0,nextAi):rest;
      if(code==="10")ai.batchNo=value.replace(groupSep,"");
      else ai.serialNo=value.replace(groupSep,"");
      i=(nextAi>0?i+2+nextAi:nextSep>=0?nextSep+1:cleaned.length);
      continue;
    }
    i++;
  }
  if(ai.gtin)ai.barcode=ai.gtin;
  return ai;
}
function parseBarcode(raw){
  const normalized=normalizeBarcode(raw),gs1=splitGs1(raw);
  const ai={...gs1};
  if(!ai.gtin&&/^\d{8,14}$/.test(normalized)){ai.gtin=normalized;ai.barcode=normalized}
  const common=normalized.match(/^(\d{8,14})[-|_ ]?([A-Za-z0-9.-]{3,30})?[-|_ ]?((?:20)?\d{2}[01]\d[0-3]\d)?$/);
  if(!ai.gtin&&common){ai.gtin=common[1];ai.barcode=common[1];if(common[2])ai.batchNo=common[2];if(common[3])ai.expiryDate=compactDate(common[3].length===6?common[3]:common[3])}
  return ai;
}
function setField(form,name,value){
  if(value===undefined||value===null||value==="")return;
  const field=form.elements[name];if(!field)return;
  if(field.tagName==="SELECT"){
    const exists=[...field.options].some(o=>o.value===String(value)||o.textContent===String(value));
    if(!exists)field.add(new Option(String(value),String(value)));
  }
  field.value=String(value);
}
function fillMedicineForm(item,parsed,source){
  const m={...item};
  setField(medicineEntryForm,"barcode",parsed.gtin||parsed.barcode||medicineBarcodeInput.value);
  setField(medicineEntryForm,"name",m.name);
  setField(medicineEntryForm,"code",m.code||m.approvalNo||`BC-${parsed.gtin||Date.now()}`);
  setField(medicineEntryForm,"category",m.category||"西药");
  setField(medicineEntryForm,"spec",m.spec);
  setField(medicineEntryForm,"unit",m.unit);
  setField(medicineEntryForm,"manufacturer",m.manufacturer);
  setField(medicineEntryForm,"minStock",m.minStock);
  setField(medicineEntryForm,"salePrice",m.salePrice);
  setField(medicineEntryForm,"batchNo",parsed.batchNo||m.batchNo);
  setField(medicineEntryForm,"productionDate",parsed.productionDate||m.productionDate);
  setField(medicineEntryForm,"expiryDate",parsed.expiryDate||m.expiryDate);
  setField(medicineEntryForm,"quantity",parsed.quantity||m.quantity);
  lookupResult.innerHTML=resultHtml("lookup-success","已适配药品资料",[
    `${m.name||"待补药品名称"} · ${m.spec||"待补规格"} · ${m.manufacturer||"待补厂家"}`,
    `条码 ${parsed.gtin||parsed.barcode||"-"}${parsed.batchNo?` · 批号 ${parsed.batchNo}`:""}${parsed.expiryDate?` · 有效期 ${parsed.expiryDate}`:""}`,
    `来源：${source}。保存前请核对包装、批号和有效期。`
  ]);
}
function fillStockForm(item,parsed,source){
  const barcode=parsed.gtin||parsed.barcode||stockBarcodeInput.value.trim();
  const medicine=data.medicines.find(m=>m.barcode===barcode||m.code===barcode||m.name===item?.name);
  if(medicine)setField(stockEntryForm,"medicineId",medicine.id);
  setField(stockEntryForm,"batchNo",parsed.batchNo||item?.batchNo);
  setField(stockEntryForm,"productionDate",parsed.productionDate||item?.productionDate);
  setField(stockEntryForm,"expiryDate",parsed.expiryDate||item?.expiryDate);
  setField(stockEntryForm,"quantity",parsed.quantity||item?.quantity);
  stockLookupResult.innerHTML=resultHtml(medicine?"lookup-success":"lookup-missing",medicine?"已适配入库批次":"已解析批次，但本药品未建档",[
    medicine?`${medicine.name} · ${medicine.spec}`:"请先在“录入新药品”中保存药品档案，再回到入库登记。",
    `条码 ${barcode||"-"}${parsed.batchNo?` · 批号 ${parsed.batchNo}`:""}${parsed.expiryDate?` · 有效期 ${parsed.expiryDate}`:""}`,
    `来源：${source}`
  ]);
}
function resultHtml(cls,title,lines){return `<div class="${cls}"><strong>${title}</strong>${lines.map(x=>`<span>${x}</span>`).join("")}</div>`}
async function externalLookup(barcode){
  const endpoint=localStorage.getItem("clinic-barcode-api-url");if(!endpoint)return null;
  try{
    const response=await fetch(endpoint.replace("{barcode}",encodeURIComponent(barcode)));
    if(!response.ok)return null;
    const body=await response.json(),item=body.data||body.product||body;
    if(!item?.name&&!item?.药品名称)return null;
    return {name:item.name||item.药品名称,code:item.code||item.药品编码||item.批准文号||"",category:item.category||item.分类||"西药",spec:item.spec||item.规格||"",unit:item.unit||item.单位||"",manufacturer:item.manufacturer||item.企业名称||"",approvalNo:item.approvalNo||item.批准文号||"",salePrice:item.salePrice||item.price||item.价格||"",batchNo:item.batchNo||item.批号||"",productionDate:item.productionDate||compactDate(item.生产日期),expiryDate:item.expiryDate||compactDate(item.有效期至),quantity:item.quantity||item.数量||""};
  }catch{return null}
}
async function lookupBarcode(target="medicine"){
  const input=target==="stock"?stockBarcodeInput:medicineBarcodeInput,result=target==="stock"?stockLookupResult:lookupResult,form=target==="stock"?stockEntryForm:medicineEntryForm;
  const raw=input.value.trim();if(!raw)return toast("请先扫描或输入条形码");
  const parsed=parseBarcode(raw),barcode=parsed.gtin||parsed.barcode||raw;
  input.value=barcode;
  result.innerHTML='<div class="lookup-loading">正在解析条码并查询药品资料...</div>';
  const local=data.medicines.find(m=>m.barcode===barcode);
  const item=local||await externalLookup(barcode)||demoBarcodeCatalog[barcode]||{};
  if(target==="stock"){fillStockForm(item,parsed,local?"诊所已有药品库":item.name?"药品资料库":"条码解析");return}
  if(item.name||parsed.batchNo||parsed.expiryDate){fillMedicineForm(item,parsed,local?"诊所已有药品库":item.name?"药品资料库":"条码解析");return}
  result.innerHTML=resultHtml("lookup-missing","暂未匹配到药品资料",["条码已保留，可手动填写；如包装上是组合码，系统会尽量解析批号和有效期。"]);
}
document.getElementById("lookupBarcode").onclick=()=>lookupBarcode("medicine");
document.getElementById("lookupStockBarcode").onclick=()=>lookupBarcode("stock");
[medicineBarcodeInput,stockBarcodeInput].forEach(input=>input?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();lookupBarcode(input.id==="stockBarcode"?"stock":"medicine")}}));
medicineBarcodeInput.addEventListener("input",()=>{lookupResult.innerHTML=""});
stockBarcodeInput.addEventListener("input",()=>{stockLookupResult.innerHTML=""});
window.handleScannedBarcode=(value,targetId)=>{
  const input=document.getElementById(targetId)||medicineBarcodeInput;
  input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));
  lookupBarcode(input.id==="stockBarcode"?"stock":"medicine");
};
