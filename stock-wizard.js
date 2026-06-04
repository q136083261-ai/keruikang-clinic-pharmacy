(function () {
  const stockModal = document.getElementById("stockModal");
  const stockForm = document.getElementById("stockForm");
  if (!stockModal || !stockForm) return;

  const wizard = document.createElement("div");
  wizard.className = "stock-wizard";
  wizard.innerHTML = `
    <div class="wizard-title">
      <strong>扫码入库向导</strong>
      <span>按固定流程完成：扫码 -> 识别药品 -> 批次/效期 -> 入库数量 -> 确认提交</span>
    </div>
    <div class="wizard-steps">
      <div class="wizard-step" data-step="scan"><b>1</b><span>扫码</span></div>
      <div class="wizard-step" data-step="identify"><b>2</b><span>识别药品</span></div>
      <div class="wizard-step" data-step="batch"><b>3</b><span>批次效期</span></div>
      <div class="wizard-step" data-step="quantity"><b>4</b><span>入库数量</span></div>
      <div class="wizard-step" data-step="confirm"><b>5</b><span>核对提交</span></div>
    </div>
    <p class="wizard-hint" id="stockWizardHint">先扫描包装条码或 GS1 批次码。</p>
  `;
  stockForm.parentNode.insertBefore(wizard, stockForm);

  function value(name) {
    return String(stockForm.elements[name]?.value || "").trim();
  }

  function isStockIn() {
    return new FormData(stockForm).get("type") === "in";
  }

  function setStep(name, state) {
    const node = wizard.querySelector(`[data-step="${name}"]`);
    if (!node) return;
    node.classList.toggle("done", state === "done");
    node.classList.toggle("active", state === "active");
  }

  function updateWizard() {
    if (!isStockIn()) {
      wizard.classList.add("muted");
      document.getElementById("stockWizardHint").textContent = "当前是出库模式，扫码入库向导会在入库模式下启用。";
      return;
    }
    wizard.classList.remove("muted");

    const scanned = !!value("stockBarcode");
    const identified = !!value("medicineId") && (stockForm.dataset.scanState === "success" || stockForm.dataset.scanState === "warn");
    const batched = !!value("batchNo") && !!value("productionDate") && !!value("expiryDate");
    const quantified = Number(value("quantity")) > 0;
    const confirmed = !!stockForm.elements.stockScanConfirmed?.checked;

    const states = {
      scan: scanned ? "done" : "active",
      identify: identified ? "done" : scanned ? "active" : "",
      batch: batched ? "done" : identified ? "active" : "",
      quantity: quantified ? "done" : batched ? "active" : "",
      confirm: confirmed ? "done" : quantified ? "active" : ""
    };

    Object.entries(states).forEach(([name, state]) => setStep(name, state));

    const hint = !scanned ? "先扫描包装条码或 GS1 批次码。"
      : !identified ? "点击“适配入库”，确认系统识别到正确药品。"
      : !batched ? "补齐或核对批号、生产日期和有效期。"
      : !quantified ? "填写本次实际入库数量。"
      : !confirmed ? "核对包装、批号、效期和数量后勾选确认。"
      : "流程完整，可以提交入库。";
    document.getElementById("stockWizardHint").textContent = hint;
  }

  stockForm.addEventListener("input", updateWizard);
  stockForm.addEventListener("change", updateWizard);
  document.addEventListener("click", event => {
    if (event.target.closest('[data-open="stockModal"],[data-stock]')) {
      setTimeout(updateWizard, 80);
    }
  });
  window.addEventListener("clinic:barcode-lookup-complete", updateWizard);
  updateWizard();
})();
