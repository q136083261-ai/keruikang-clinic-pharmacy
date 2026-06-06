(function () {
  const medicineForm = document.getElementById("medicineForm");
  const stockForm = document.getElementById("stockForm");
  if (!medicineForm && !stockForm) return;

  function value(form, name) {
    return String(form?.elements[name]?.value || "").trim();
  }

  function isConfirmed(form, type) {
    return !!form?.elements[type === "stock" ? "stockScanConfirmed" : "scanConfirmed"]?.checked;
  }

  function isDuplicate(form) {
    return form?.dataset.duplicateTrace === "true" || form?.dataset.scanState === "duplicate";
  }

  function lookup(form) {
    try {
      return JSON.parse(form?.dataset.lookupResult || "{}") || {};
    } catch {
      return {};
    }
  }

  function hasBatch(form) {
    return !!value(form, "batchNo") && !!value(form, "productionDate") && !!value(form, "expiryDate");
  }

  function hasQuantity(form) {
    return Number(value(form, "quantity")) > 0;
  }

  function hasMedicine(form, type) {
    return type === "stock" ? !!value(form, "medicineId") : !!value(form, "name") && !!value(form, "spec");
  }

  function insertPanel(form, type) {
    if (!form || form.querySelector(".trace-inbound-panel")) return;
    const panel = document.createElement("div");
    panel.className = "trace-inbound-panel";
    panel.innerHTML = `
      <div class="trace-panel-head">
        <div>
          <strong>扫码枪快速入库流程</strong>
          <span>第一次建主档，第二次同药只建新批次，同一盒重复扫会拦截。</span>
        </div>
        <button class="btn secondary trace-focus-btn" type="button">聚焦扫码框</button>
      </div>
      <div class="trace-flow">
        <div class="trace-step" data-trace-step="scan"><b>1</b><span>扫码</span></div>
        <div class="trace-step" data-trace-step="match"><b>2</b><span>查重/匹配</span></div>
        <div class="trace-step" data-trace-step="drug"><b>3</b><span>药品主档</span></div>
        <div class="trace-step" data-trace-step="batch"><b>4</b><span>批次效期</span></div>
        <div class="trace-step" data-trace-step="confirm"><b>5</b><span>核对入库</span></div>
      </div>
      <p class="trace-hint"></p>
    `;
    form.insertBefore(panel, form.firstElementChild);
    panel.querySelector(".trace-focus-btn").addEventListener("click", () => {
      const input = document.getElementById(type === "stock" ? "stockBarcode" : "medicineBarcode");
      input?.focus();
      input?.select?.();
    });
  }

  function setStep(panel, name, state) {
    const node = panel.querySelector(`[data-trace-step="${name}"]`);
    if (!node) return;
    node.classList.toggle("done", state === "done");
    node.classList.toggle("active", state === "active");
    node.classList.toggle("blocked", state === "blocked");
  }

  function updatePanel(form, type) {
    const panel = form?.querySelector(".trace-inbound-panel");
    if (!panel) return;
    const scanned = !!value(form, type === "stock" ? "stockBarcode" : "barcode");
    const matched = !!lookup(form).medicineId || form.dataset.scanState === "success" || form.dataset.scanState === "warn";
    const drugReady = hasMedicine(form, type);
    const batchReady = hasBatch(form);
    const quantityReady = hasQuantity(form);
    const confirmed = isConfirmed(form, type);
    const duplicate = isDuplicate(form);

    if (duplicate) {
      ["scan", "match"].forEach(name => setStep(panel, name, "blocked"));
      ["drug", "batch", "confirm"].forEach(name => setStep(panel, name, ""));
      panel.querySelector(".trace-hint").textContent = "该盒药已经入库，系统已拦截，不能重复保存。";
      panel.classList.add("blocked");
      return;
    }

    panel.classList.remove("blocked");
    setStep(panel, "scan", scanned ? "done" : "active");
    setStep(panel, "match", matched ? "done" : scanned ? "active" : "");
    setStep(panel, "drug", drugReady ? "done" : matched ? "active" : "");
    setStep(panel, "batch", batchReady ? "done" : drugReady ? "active" : "");
    setStep(panel, "confirm", confirmed ? "done" : quantityReady && batchReady ? "active" : "");

    const hint = !scanned ? "请用扫码枪扫描药盒追溯码、GS1 码或商品条码；扫码枪建议开启 HID 键盘模式和扫码后 Enter。"
      : !matched ? "已收到扫码内容，请点击自动适配；如果是追溯码，会先查重。"
      : !drugReady ? "请确认药品名称、规格、厂家和批准文号；首次录入会创建药品主档。"
      : !batchReady ? "请补齐或核对批号、生产日期、有效期。"
      : !quantityReady ? "请填写本次入库数量。"
      : !confirmed ? "请勾选“我已核对”，然后保存。"
      : "流程完整，可以保存入库。";
    panel.querySelector(".trace-hint").textContent = hint;
  }

  insertPanel(medicineForm, "medicine");
  insertPanel(stockForm, "stock");

  function updateAll() {
    if (medicineForm) updatePanel(medicineForm, "medicine");
    if (stockForm) updatePanel(stockForm, "stock");
  }

  [medicineForm, stockForm].forEach(form => {
    form?.addEventListener("input", updateAll);
    form?.addEventListener("change", updateAll);
  });
  window.addEventListener("clinic:barcode-lookup-complete", updateAll);
  document.addEventListener("click", event => {
    if (event.target.closest('[data-open="medicineModal"]')) {
      setTimeout(() => {
        document.getElementById("medicineBarcode")?.focus();
        updateAll();
      }, 120);
    }
    if (event.target.closest('[data-open="stockModal"],[data-stock]')) {
      setTimeout(() => {
        document.getElementById("stockBarcode")?.focus();
        updateAll();
      }, 120);
    }
  });
  updateAll();
})();
