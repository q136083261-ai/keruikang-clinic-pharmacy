(function () {
  const stockModal = document.getElementById("stockModal");
  const stockForm = document.getElementById("stockForm");
  const stockMedicine = document.getElementById("stockMedicine");
  const batchFields = document.getElementById("batchFields");
  if (!stockModal || !stockForm || !stockMedicine || !batchFields) return;

  const resultCache = new Map();
  let searchTimer = null;

  function say(message) {
    if (typeof toast === "function") toast(message);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function medicineFromData(id) {
    return (window.data?.medicines || []).find(item => item.id === id) || null;
  }

  function normalizeMedicine(item) {
    if (!item) return null;
    return {
      id: item.id,
      name: item.name || "",
      internalCode: item.internalCode || item.code || item.internal_code || "",
      manufacturer: item.manufacturer || "",
      category: item.category || "其他",
      spec: item.spec || item.specification || "",
      unit: item.unit || item.default_unit || "盒",
      salePrice: Number(item.salePrice ?? item.retail_price ?? 0),
      minStock: Number(item.minStock ?? item.low_stock_threshold ?? 20),
      disabled: item.disabled === true || item.active === false,
      batchDraft: item.batchDraft || null,
      batches: item.batches || []
    };
  }

  function addMedicineToLocal(master) {
    const normalized = normalizeMedicine(master);
    if (!normalized?.id) return null;
    const existing = medicineFromData(normalized.id);
    if (existing) {
      Object.assign(existing, normalized, { batches: existing.batches || [] });
      return existing;
    }
    const local = {
      ...normalized,
      code: normalized.internalCode,
      barcode: "",
      dispenseUnit: normalized.unit,
      conversion: 1,
      location: "药房默认库位",
      warningDays: window.data?.settings?.expiryWarningDays || 90,
      publicVisible: false,
      batches: []
    };
    window.data?.medicines?.push(local);
    if (typeof renderSelect === "function") renderSelect();
    return local;
  }

  function formatDateByPrecision(date, precision) {
    if (!date) return "";
    return precision === "month" ? String(date).slice(0, 7) : String(date).slice(0, 10);
  }

  function setValue(name, value, overwrite = true) {
    const field = stockForm.elements[name];
    if (!field || value == null || value === "") return;
    if (overwrite || !String(field.value || "").trim()) field.value = value;
  }

  function setMedicineInfo(medicine) {
    const info = document.getElementById("manualMedicineInfo");
    if (!info) return;
    if (!medicine) {
      info.innerHTML = "请先搜索或选择一个药品主档。";
      info.classList.add("muted");
      return;
    }
    info.classList.remove("muted");
    info.innerHTML = `
      <strong>${escapeHtml(medicine.name)}</strong>
      <span>厂家：${escapeHtml(medicine.manufacturer || "未填写")}</span>
      <span>分类：${escapeHtml(medicine.category || "-")}</span>
      <span>规格：${escapeHtml(medicine.spec || "-")}</span>
      <span>单位：${escapeHtml(medicine.unit || "盒")}</span>
      <span>零售价：${medicine.salePrice ? `¥${medicine.salePrice}` : "未填写"}</span>
      <span>预警值：${medicine.minStock ?? 20}</span>
    `;
  }

  function showDraftNotice(draft) {
    const notice = document.getElementById("manualDraftNotice");
    if (!notice) return;
    if (!draft) {
      notice.hidden = true;
      notice.innerHTML = "";
      return;
    }
    const expiry = formatDateByPrecision(draft.expiryDate, draft.expiryPrecision);
    const production = formatDateByPrecision(draft.productionDate, draft.productionPrecision);
    notice.hidden = false;
    notice.innerHTML = `
      <strong>来自 Excel 导入参考资料，请按药盒实物核对后再入库。</strong>
      <span>参考生产日期：${escapeHtml(production || "未提供")}</span>
      <span>参考有效期：${escapeHtml(expiry || "未提供")}</span>
      <span>参考单位：${escapeHtml(draft.unit || "未提供")}</span>
      <span>参考零售价：${draft.retailPrice ? `¥${draft.retailPrice}` : "未提供"}</span>
    `;
  }

  async function applyDraft(medicine) {
    let draft = medicine?.batchDraft || null;
    if (!draft && medicine?.id && window.KERUIKANG_CLOUD_INVENTORY?.getLatestBatchDraft) {
      try {
        draft = await window.KERUIKANG_CLOUD_INVENTORY.getLatestBatchDraft(medicine.id);
        if (draft) medicine.batchDraft = draft;
      } catch (error) {
        console.warn("manual stock draft lookup skipped", error);
      }
    }
    if (draft) {
      setValue("productionDate", draft.productionDate, false);
      setValue("expiryDate", draft.expiryDate, false);
      setValue("unit", draft.unit, false);
      setValue("salePrice", draft.retailPrice, false);
    }
    showDraftNotice(draft);
  }

  async function selectMedicine(master) {
    const medicine = addMedicineToLocal(master) || normalizeMedicine(master);
    if (!medicine?.id) return;
    stockMedicine.value = medicine.id;
    stockForm.dataset.selectedMedicineId = medicine.id;
    const search = document.getElementById("manualMedicineSearch");
    if (search) search.value = medicine.manufacturer ? `${medicine.name} / ${medicine.manufacturer}` : medicine.name;
    setValue("unit", medicine.unit || "盒", true);
    setValue("salePrice", medicine.salePrice || "", false);
    setMedicineInfo(medicine);
    await applyDraft(medicine);
  }

  function localMedicineSearch(term) {
    const keyword = String(term || "").trim().toLowerCase();
    if (!keyword) return [];
    return (window.data?.medicines || [])
      .filter(item => !item.disabled)
      .filter(item => [item.name, item.manufacturer, item.category, item.spec, item.code, item.internalCode]
        .some(value => String(value || "").toLowerCase().includes(keyword)))
      .map(normalizeMedicine)
      .slice(0, 10);
  }

  function renderResults(results) {
    const box = document.getElementById("manualMedicineResults");
    if (!box) return;
    resultCache.clear();
    if (!results.length) {
      box.hidden = false;
      box.innerHTML = `<div class="manual-result-empty">没有找到药品，可点击右侧“快速新增药品”。</div>`;
      return;
    }
    box.hidden = false;
    box.innerHTML = results.map(item => {
      resultCache.set(item.id, item);
      return `
        <button type="button" class="manual-result-item" data-manual-result="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.manufacturer || "未填写厂家")} · ${escapeHtml(item.category || "-")} · ${escapeHtml(item.unit || "盒")}</span>
          <small>${escapeHtml(item.spec || "未填写规格")} ${item.salePrice ? `· ¥${item.salePrice}` : ""}</small>
        </button>
      `;
    }).join("");
  }

  async function runSearch() {
    const input = document.getElementById("manualMedicineSearch");
    const term = input?.value || "";
    if (!term.trim()) {
      renderResults([]);
      document.getElementById("manualMedicineResults").hidden = true;
      return;
    }
    const merged = new Map();
    localMedicineSearch(term).forEach(item => merged.set(item.id, item));
    if (window.KERUIKANG_CLOUD_INVENTORY?.searchMedicineMasters) {
      try {
        const rows = await window.KERUIKANG_CLOUD_INVENTORY.searchMedicineMasters(term);
        rows.map(normalizeMedicine).forEach(item => merged.set(item.id, item));
      } catch (error) {
        console.warn("manual medicine search skipped cloud lookup", error);
      }
    }
    renderResults([...merged.values()]);
  }

  function quickField(name) {
    return document.querySelector(`[data-quick-medicine="${name}"]`)?.value || "";
  }

  async function saveQuickMedicine() {
    const values = {
      name: quickField("name"),
      manufacturer: quickField("manufacturer"),
      category: quickField("category"),
      specification: quickField("specification"),
      defaultUnit: quickField("defaultUnit"),
      retailPrice: quickField("retailPrice"),
      lowStockThreshold: quickField("lowStockThreshold")
    };
    if (!String(values.name || "").trim()) {
      say("请填写药品名称");
      return;
    }
    try {
      let master;
      if (window.KERUIKANG_CLOUD_INVENTORY?.createMedicineMaster) {
        master = await window.KERUIKANG_CLOUD_INVENTORY.createMedicineMaster(values);
      } else {
        master = {
          id: crypto.randomUUID(),
          internalCode: `MED-LOCAL-${Date.now()}`,
          name: values.name,
          manufacturer: values.manufacturer,
          category: values.category || "其他",
          spec: values.specification,
          unit: values.defaultUnit || "盒",
          salePrice: Number(values.retailPrice || 0),
          minStock: Number(values.lowStockThreshold || 20),
          active: true
        };
      }
      await selectMedicine(master);
      document.getElementById("manualQuickAddPanel").hidden = true;
      say("药品主档已新增并选中");
    } catch (error) {
      console.error(error);
      say("快速新增药品失败：" + error.message);
    }
  }

  function ensureManualUi() {
    stockForm.classList.add("manual-stock-form");
    const headTitle = stockModal.querySelector(".modal-head h2");
    const headText = stockModal.querySelector(".modal-head p");
    if (headTitle) headTitle.textContent = "出入库登记";
    if (headText) headText.textContent = "默认使用纯手工入库；扫码仅作为高级辅助。";

    const label = stockMedicine.closest("label");
    if (label && !document.getElementById("manualMedicineSearch")) {
      label.classList.add("manual-medicine-label");
      label.querySelector("span").textContent = "选择药品 *";
      stockMedicine.insertAdjacentHTML("beforebegin", `
        <div class="manual-medicine-search">
          <input id="manualMedicineSearch" type="search" autocomplete="off" placeholder="输入药品名称、厂家或编码搜索本地药品主档">
          <button type="button" class="btn secondary" id="manualQuickAddToggle">快速新增药品</button>
        </div>
        <div class="manual-medicine-results" id="manualMedicineResults" hidden></div>
      `);
      label.insertAdjacentHTML("afterend", `
        <div class="manual-medicine-info muted" id="manualMedicineInfo">请先搜索或选择一个药品主档。</div>
        <div class="manual-quick-add" id="manualQuickAddPanel" hidden>
          <strong>快速新增药品主档</strong>
          <div class="manual-quick-grid">
            <label><span>药品名称 *</span><input data-quick-medicine="name" placeholder="例如：重感灵胶囊"></label>
            <label><span>生产厂家</span><input data-quick-medicine="manufacturer" placeholder="厂家名称"></label>
            <label><span>分类</span><select data-quick-medicine="category"><option>西药</option><option>中成药</option><option>外用药</option><option>医疗耗材</option><option>其他</option></select></label>
            <label><span>规格</span><input data-quick-medicine="specification" placeholder="例如：0.25g × 24粒"></label>
            <label><span>默认单位</span><input data-quick-medicine="defaultUnit" value="盒"></label>
            <label><span>零售价</span><input data-quick-medicine="retailPrice" type="number" min="0" step="0.01"></label>
            <label><span>预警值</span><input data-quick-medicine="lowStockThreshold" type="number" min="0" value="20"></label>
          </div>
          <div class="manual-quick-actions">
            <button type="button" class="btn ghost" id="manualQuickAddCancel">取消</button>
            <button type="button" class="btn primary" id="manualQuickAddSave">新增并选中</button>
          </div>
        </div>
      `);
    }

    const expiryLabel = stockForm.elements.expiryDate?.closest("label");
    if (expiryLabel && !stockForm.elements.unit) {
      expiryLabel.insertAdjacentHTML("afterend", `
        <label><span>单位</span><input name="unit" placeholder="盒"></label>
        <label><span>对外零售价</span><input name="salePrice" type="number" min="0" step="0.01" placeholder="可选"></label>
      `);
    }

    if (!document.getElementById("manualDraftNotice")) {
      batchFields.insertAdjacentHTML("afterbegin", `
        <div class="manual-draft-notice" id="manualDraftNotice" hidden></div>
      `);
    }

    const confirmLabel = stockForm.querySelector(".scan-confirm");
    if (confirmLabel) {
      confirmLabel.classList.add("manual-confirm");
      confirmLabel.querySelector("span").textContent = "我已核对本次入库包装、药品、批号、生产日期和有效期";
    }

    const barcodeLabel = stockForm.querySelector("label.barcode-entry");
    const lookupResult = document.getElementById("stockLookupResult");
    if (barcodeLabel && !document.getElementById("manualBarcodeDetails")) {
      const details = document.createElement("details");
      details.className = "manual-advanced-details";
      details.id = "manualBarcodeDetails";
      details.innerHTML = `<summary>扫码辅助/高级功能</summary>`;
      barcodeLabel.parentNode.insertBefore(details, barcodeLabel);
      details.appendChild(barcodeLabel);
      if (lookupResult) details.appendChild(lookupResult);
    }

    const wizard = document.querySelector(".stock-wizard");
    const tracePanel = stockForm.querySelector(".trace-inbound-panel");
    if ((wizard || tracePanel) && !document.getElementById("manualScanDetails")) {
      const details = document.createElement("details");
      details.className = "manual-advanced-details";
      details.id = "manualScanDetails";
      details.innerHTML = `<summary>扫码辅助/高级功能说明</summary>`;
      const actions = stockForm.querySelector(".form-actions");
      stockForm.insertBefore(details, actions);
      if (wizard) details.appendChild(wizard);
      if (tracePanel) details.appendChild(tracePanel);
    }
  }

  function bindManualUi() {
    document.getElementById("manualMedicineSearch")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 250);
    });

    document.getElementById("manualMedicineSearch")?.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const first = document.querySelector("[data-manual-result]");
      if (first) first.click();
    });

    document.getElementById("manualMedicineResults")?.addEventListener("click", event => {
      const button = event.target.closest("[data-manual-result]");
      if (!button) return;
      const medicine = resultCache.get(button.dataset.manualResult);
      if (medicine) selectMedicine(medicine);
      document.getElementById("manualMedicineResults").hidden = true;
    });

    stockMedicine.addEventListener("change", () => {
      const medicine = normalizeMedicine(medicineFromData(stockMedicine.value));
      if (medicine) selectMedicine(medicine);
    });

    document.getElementById("manualQuickAddToggle")?.addEventListener("click", () => {
      const panel = document.getElementById("manualQuickAddPanel");
      panel.hidden = !panel.hidden;
    });
    document.getElementById("manualQuickAddCancel")?.addEventListener("click", () => {
      document.getElementById("manualQuickAddPanel").hidden = true;
    });
    document.getElementById("manualQuickAddSave")?.addEventListener("click", saveQuickMedicine);

    document.addEventListener("click", event => {
      if (!event.target.closest('[data-open="stockModal"],[data-stock]')) return;
      setTimeout(() => {
        const selected = normalizeMedicine(medicineFromData(stockMedicine.value));
        if (selected) selectMedicine(selected);
        document.getElementById("manualMedicineSearch")?.focus();
      }, 180);
    });
  }

  ensureManualUi();
  bindManualUi();
  setMedicineInfo(normalizeMedicine(medicineFromData(stockMedicine.value)));
})();
