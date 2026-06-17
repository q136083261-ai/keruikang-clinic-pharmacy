const permissionDefs=[
  ["medicines.read","查看药品","查看药品主档与基础库存"],
  ["medicine.create","录入药品","新增药品档案并登记首批库存"],
  ["medicines.create","录入药品/商品","护士端新增药品主档"],
  ["medicine.edit","编辑药品","修改药品档案、单位、条码和提醒设置"],
  ["inventory.read","查看库存","查看药品批次和库存数量"],
  ["stock.in","药品入库","登记采购或退回的入库批次"],
  ["stock.out","药品出库","登记门诊发药等库存扣减"],
  ["batch.read","查看批次","查看批号、生产日期和有效期"],
  ["batch.create","新建批次","入库时创建新的药品批次"],
  ["inventory.count","提交库存盘点","提交账实差异并等待管理员审核"],
  ["disposal.create","提交报损申请","提交过期、破损或召回药品处理申请"],
  ["purchase.manage","采购与供应商","维护供应商并登记采购入库"],
  ["prescription.create","处方收费","登记处方、收费并完成发药"],
  ["refund.create","退药退款申请","提交退药退款申请并等待审核"],
  ["public.manage","对外药品管理","设置顾客窗口公开药品和零售价"],
  ["alerts.view","查看效期预警","查看过期与临期药品清单"],
  ["transactions.view","查看出入库流水","查看所有库存变动记录"],
  ["reports.export","导出报表","导出库存、流水和收费统计报表"],
  ["users.manage","管理用户权限","新增、启停账号并授予权限"]
];
const defaultPermissions=["medicine.create","medicine.edit","stock.in","stock.out","inventory.count","disposal.create","purchase.manage","prescription.create","refund.create","public.manage","alerts.view","transactions.view","reports.export"];
const nursePermissions=["medicines.read","medicine.create","medicines.create","inventory.read","stock.in","stock.out","batch.read","batch.create"];
const rolePermissionDefaults={admin:permissionDefs.map(x=>x[0]),user:[...defaultPermissions],manager:[...defaultPermissions],nurse:[...nursePermissions],stock_operator:[...nursePermissions]};
const roleLabels={admin:"管理员",manager:"医生/管理人员",user:"普通用户",nurse:"护士",stock_operator:"护士"};
function ensureUsers(){
  if(!data.users)data.users=[
    {id:"u-admin",name:"诊所管理员",role:"admin",active:true,permissions:permissionDefs.map(x=>x[0])},
    {id:"u-staff",name:"药房录入员",role:"user",active:true,permissions:[...defaultPermissions]},
    {id:"u-front",name:"前台护士",role:"nurse",active:true,permissions:[...nursePermissions]}
  ];
  if(!data.currentUserId||!data.users.some(u=>u.id===data.currentUserId&&u.active))data.currentUserId="";
}
function currentUser(){ensureUsers();return data.users.find(u=>u.id===data.currentUserId)||{id:"",name:"未登录",role:"guest",active:false,permissions:[]}}
function can(permission){const user=currentUser();return user.role==="admin"||(user.permissions||[]).includes(permission)||(user.role==="nurse"&&nursePermissions.includes(permission))||(user.role==="stock_operator"&&nursePermissions.includes(permission))}
function canAny(list){return list.split(",").some(can)}
function requirePermission(permission){if(can(permission))return true;toast("当前用户没有此操作权限，请联系管理员授权");return false}
function permissionLabel(key){return (permissionDefs.find(x=>x[0]===key)||[key,key])[1]}
function renderPermissionOptions(selected=[]){
  document.getElementById("permissionOptions").innerHTML=permissionDefs.filter(x=>x[0]!=="users.manage").map(x=>`<label class="permission-option"><input type="checkbox" name="permissions" value="${x[0]}" ${selected.includes(x[0])?"checked":""}><span><strong>${x[1]}</strong><small>${x[2]}</small></span></label>`).join("");
}
function renderUsers(){
  const table=document.getElementById("userTable");if(!table)return;
  const me=currentUser();
  table.innerHTML=data.users.map(u=>{const reset=me.role==="admin"&&u.id!==me.id&&u.role!=="admin"?` · <button class="link-btn" data-reset-password="${u.id}">重置密码</button>`:"";const actions=u.role==="admin"?"系统管理员":`<button class="link-btn" data-edit-user="${u.id}">编辑权限</button>${reset} · <button class="link-btn" data-toggle-user="${u.id}">${u.active?"停用":"启用"}</button>`;const roleText=roleLabels[u.role]||"普通用户";return `<tr><td><div class="drug-name"><strong>${u.name}</strong><span>${u.email||u.id}</span></div></td><td>${badge([roleText,u.role==="admin"?"risk-green":u.role==="nurse"||u.role==="stock_operator"?"risk-orange":"risk-orange"])}</td><td><span class="status-dot" style="background:${u.active?"#16806e":"#aaa"}"></span>${u.active?"已启用":"已停用"}</td><td><div class="permission-tags">${(u.role==="admin"?["全部权限"]:(u.permissions||[]).map(permissionLabel)).map(x=>`<span class="permission-tag">${x}</span>`).join("")}</div></td><td>${actions}</td></tr>`}).join("");
}
function updateStockTypeAccess(){
  document.querySelectorAll('input[name="type"]').forEach(x=>{x.disabled=!can("stock."+x.value)});
  let checked=document.querySelector('input[name="type"]:checked');
  if(checked&&checked.disabled){const allowed=document.querySelector('input[name="type"]:not(:disabled)');if(allowed){allowed.checked=true;allowed.dispatchEvent(new Event("change"))}}
}
function renderPermissionUI(){
  ensureUsers();
  const select=document.getElementById("currentUser");
  select.innerHTML=data.currentUserId?data.users.filter(u=>u.active).map(u=>`<option value="${u.id}" ${u.id===data.currentUserId?"selected":""}>${u.name}${u.role==="admin"?"（管理员）":""}</option>`).join(""):`<option value="">未登录</option>`;
  const accountName=document.getElementById("accountUserName");if(accountName)accountName.textContent=currentUser().name;
  document.querySelector(".clinic-card strong").textContent=currentUser().name;
  document.querySelectorAll("[data-permission]").forEach(x=>x.classList.toggle("hidden-by-permission",!can(x.dataset.permission)));
  document.querySelectorAll("[data-permission-any]").forEach(x=>x.classList.toggle("hidden-by-permission",!canAny(x.dataset.permissionAny)));
  document.querySelectorAll("[data-stock]").forEach(x=>x.classList.toggle("hidden-by-permission",!canAny("stock.in,stock.out")));
  document.getElementById("resetDemo").classList.toggle("hidden-by-permission",currentUser().role!=="admin");
  updateStockTypeAccess();
}
ensureUsers();save();
const baseRender=render;
render=function(){baseRender();ensureUsers();renderPermissionUI();renderUsers()};
const baseOpenModal=openModal;
openModal=function(id,medicineId){
  if(id==="medicineModal"&&!requirePermission("medicine.create"))return;
  if(id==="stockModal"&&!canAny("stock.in,stock.out"))return toast("当前用户没有出入库权限");
  if(id==="userModal"){
    if(!requirePermission("users.manage"))return;
    document.getElementById("userForm").reset();document.querySelector('#userForm [name="userId"]').value="";
    document.getElementById("userModalTitle").textContent="新增用户";const roleField=document.querySelector('#userForm [name="role"]');if(roleField)roleField.value="nurse";renderPermissionOptions(nursePermissions);
  }
  baseOpenModal(id,medicineId);updateStockTypeAccess();
};
const baseSwitchPage=switchPage;
switchPage=function(id){
  if(id==="permissions"&&!requirePermission("users.manage"))return;
  if(id==="alerts"&&!requirePermission("alerts.view"))return;
  if(id==="transactions"&&!requirePermission("transactions.view"))return;
  baseSwitchPage(id);
};
const medicineSubmit=document.getElementById("medicineForm").onsubmit;
document.getElementById("medicineForm").onsubmit=function(e){
  if(!requirePermission("medicine.create")){e.preventDefault();return}
  const before=Date.now();medicineSubmit.call(this,e);data.transactions.filter(t=>new Date(t.date)>=before).forEach(t=>t.operator=currentUser().name);save();render();
};
const stockSubmit=document.getElementById("stockForm").onsubmit;
document.getElementById("stockForm").onsubmit=function(e){
  const type=new FormData(this).get("type");if(!requirePermission("stock."+type)){e.preventDefault();return}
  const before=Date.now();stockSubmit.call(this,e);data.transactions.filter(t=>new Date(t.date)>=before).forEach(t=>t.operator=currentUser().name);save();render();
};
document.getElementById("currentUser").onchange=e=>{e.target.value=data.currentUserId||"";if(window.forceSignOutAndShowLogin)return window.forceSignOutAndShowLogin("switch_account");data.currentUserId="";save();closeModals();render();document.getElementById("loginScreen").classList.remove("hidden");toast("请重新登录要切换的账号")};
const baseResetDemo=document.getElementById("resetDemo").onclick;
document.getElementById("resetDemo").onclick=e=>{if(currentUser().role!=="admin")return toast("仅管理员可以恢复演示数据");baseResetDemo.call(e.currentTarget,e)};
async function adminCreateUser(payload){
  const client=window.supabaseClient||window.CLINIC_SUPABASE_CLIENT;
  if(!client?.auth)throw new Error("云端登录组件未就绪");
  const {data:sessionData,error:sessionError}=await client.auth.getSession();
  const token=sessionData?.session?.access_token;
  if(sessionError||!token)throw new Error("当前登录状态已失效，请重新登录");
  const response=await fetch("/api/admin-create-user",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.success)throw new Error(result.message||"创建用户失败");
  return result.user;
}
document.getElementById("userForm").onsubmit=async e=>{
  e.preventDefault();if(!requirePermission("users.manage"))return;
  const form=new FormData(e.target),id=form.get("userId"),role=form.get("role")||"user",permissions=form.getAll("permissions"),existing=data.users.find(u=>u.id===id);
  try{
    if(existing){
      existing.name=form.get("name");existing.role=role;existing.active=form.get("active")==="true";existing.permissions=permissions;save();render();closeModals();toast("权限已更新");return;
    }
    const email=String(form.get("email")||"").trim(),password=String(form.get("password")||"");
    if(email&&password){
      const created=await adminCreateUser({email,password,displayName:form.get("name"),role,active:form.get("active")==="true",permissions});
      data.users.push({id:created.id,name:created.displayName||form.get("name"),email:created.email,role,active:form.get("active")==="true",permissions});
    }else{
      data.users.push({id:"u-"+Date.now(),name:form.get("name"),role,active:form.get("active")==="true",permissions});
    }
    save();render();closeModals();toast("用户已新增");
  }catch(error){toast("用户新增失败："+error.message)}
};
document.addEventListener("click",e=>{
  const button=e.target.closest("button");if(!button)return;
  if(button.dataset.editUser){if(!requirePermission("users.manage"))return;const user=data.users.find(u=>u.id===button.dataset.editUser),form=document.getElementById("userForm");document.getElementById("userModalTitle").textContent="编辑用户权限";form.elements.userId.value=user.id;form.elements.name.value=user.name;form.elements.email.value=user.email||"";form.elements.password.value="";form.elements.active.value=String(user.active);if(form.elements.role)form.elements.role.value=user.role||"user";renderPermissionOptions(user.permissions);baseOpenModal("userModal")}
  if(button.dataset.toggleUser){if(!requirePermission("users.manage"))return;const user=data.users.find(u=>u.id===button.dataset.toggleUser);user.active=!user.active;save();render();toast(user.active?"账号已启用":"账号已停用")}
});
document.querySelector('#userForm [name="role"]')?.addEventListener("change",e=>renderPermissionOptions(rolePermissionDefaults[e.target.value]||defaultPermissions));
render();
