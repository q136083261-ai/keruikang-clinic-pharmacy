(function () {
  const page = document.getElementById("prescriptions");
  const form = document.getElementById("prescriptionForm");
  if (!page || !form) return;

  const guard = document.createElement("div");
  guard.className = "patient-guard";
  guard.innerHTML = `
    <strong>患者/处方数据保护</strong>
    <span>在权限、审计、备份、数据留存规则全部完成前，请不要录入真实患者姓名、电话、身份证或诊疗隐私。当前处方模块只建议用于流程演示。</span>
  `;
  page.insertBefore(guard, page.firstElementChild);

  const patientInput = form.elements.patient;
  if (patientInput) patientInput.placeholder = "演示用姓名，请勿录入真实患者信息";

  let cloudSession = false;
  if (window.CLINIC_SUPABASE && window.supabase) {
    const client = window.supabase.createClient(
      window.CLINIC_SUPABASE.url,
      window.CLINIC_SUPABASE.publishableKey
    );
    client.auth.getSession().then(({ data }) => {
      cloudSession = !!data.session;
    });
    client.auth.onAuthStateChange((_event, session) => {
      cloudSession = !!session;
    });
  }

  form.addEventListener("submit", event => {
    if (!cloudSession) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toast("患者/处方云端功能已暂时锁定。先完成权限、日志、备份和数据留存规则后再启用。");
  }, true);
})();
