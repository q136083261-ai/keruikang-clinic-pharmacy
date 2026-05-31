/* Central client-side policy gate for the local prototype. Production must enforce the same rules server-side. */
const adminOnlyPermissions=new Set(["users.manage","medicine.delete","approvals.manage","settings.manage","backup.manage"]);
function isAdmin(){return currentUser().role==="admin"}
function allowed(permission){return isAdmin()||(!adminOnlyPermissions.has(permission)&&can(permission))}
function deny(){toast("当前用户没有此操作权限，请联系管理员授权");return false}
function requireAllowed(permission){return allowed(permission)||deny()}
function requireAdmin(){return isAdmin()||deny()}
const modalPolicies={medicineModal:"medicine.create",editMedicineModal:"medicine.edit",stockModal:"stock.in,stock.out",countModal:"inventory.count",disposalModal:"disposal.create",supplierModal:"purchase.manage",purchaseModal:"purchase.manage",prescriptionModal:"prescription.create",publicMedicineModal:"public.manage",userModal:"users.manage",settingsModal:"settings.manage"};
const pagePolicies={operations:"inventory.count,disposal.create",purchases:"purchase.manage",prescriptions:"prescription.create",reports:"reports.export",publicManage:"public.manage",approvals:"approvals.manage",audit:"users.manage",permissions:"users.manage"};
const formPolicies={medicineForm:"medicine.create",editMedicineForm:"medicine.edit",stockForm:"stock.in,stock.out",countForm:"inventory.count",disposalForm:"disposal.create",supplierForm:"purchase.manage",purchaseForm:"purchase.manage",prescriptionForm:"prescription.create",publicMedicineForm:"public.manage",userForm:"users.manage",settingsForm:"settings.manage"};
const anyAllowed=list=>list.split(",").some(allowed);
const policyAllows=policy=>policy.includes(",")?anyAllowed(policy):allowed(policy);
const policyRequire=policy=>policyAllows(policy)||deny();
const securedOpenModal=openModal;
openModal=function(id,medicineId){const policy=modalPolicies[id];if(policy&&!policyRequire(policy))return;securedOpenModal(id,medicineId)};
const securedSwitchPage=switchPage;
switchPage=function(id){const policy=pagePolicies[id];if(policy&&!policyRequire(policy))return;securedSwitchPage(id)};
document.addEventListener("submit",e=>{const policy=formPolicies[e.target.id];if(policy&&!policyRequire(policy)){e.preventDefault();e.stopImmediatePropagation()}},true);
document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;let policy="";
  if(b.dataset.deleteMedicine)policy="medicine.delete";
  else if(b.dataset.approve||b.dataset.reject)policy="approvals.manage";
  else if(b.dataset.refund)policy="refund.create";
  else if(b.dataset.publicEdit)policy="public.manage";
  else if(b.dataset.export)policy="reports.export";
  else if(b.dataset.backup||b.dataset.restore)policy="backup.manage";
  else if(b.dataset.editMedicine||b.dataset.toggleMedicine)policy="medicine.edit";
  else if(b.dataset.editUser||b.dataset.toggleUser)policy="users.manage";
  if(policy&&!policyRequire(policy)){e.preventDefault();e.stopImmediatePropagation()}
},true);
function renderSecurityUI(){
  document.querySelectorAll('[data-page="operations"]').forEach(x=>x.classList.toggle("hidden-by-permission",!anyAllowed("inventory.count,disposal.create")));
  document.querySelectorAll('[data-page="purchases"]').forEach(x=>x.classList.toggle("hidden-by-permission",!allowed("purchase.manage")));
  document.querySelectorAll('[data-page="prescriptions"]').forEach(x=>x.classList.toggle("hidden-by-permission",!allowed("prescription.create")));
  document.querySelectorAll('[data-page="reports"]').forEach(x=>x.classList.toggle("hidden-by-permission",!allowed("reports.export")));
  document.querySelectorAll('[data-page="publicManage"]').forEach(x=>x.classList.toggle("hidden-by-permission",!allowed("public.manage")));
  document.querySelectorAll('[data-page="approvals"],[data-page="audit"],[data-page="permissions"]').forEach(x=>x.classList.toggle("hidden-by-permission",!isAdmin()));
}
const securityRender=render;
render=function(){securityRender();renderSecurityUI()};
render();
