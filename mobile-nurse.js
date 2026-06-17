(function () {
  const NURSE_PERMISSIONS = [
    "medicines.read",
    "medicine.create",
    "medicines.create",
    "inventory.read",
    "stock.in",
    "stock.out",
    "batch.read",
    "batch.create"
  ];
  const panelIds = {
    home: "mobileHomePanel",
    in: "mobileStockInPanel",
    out: "mobileStockOutPanel",
    new: "mobileNewMedicinePanel",
    today: "mobileTodayPanel",
    mine: "mobileMinePanel"
  };
  let selectedInMedicine = null;
  let selectedOutMedicine = null;

  function user() {
    return typeof currentUser === "function" ? currentUser() : { role: "guest", permissions: [] };
  }

  function isAdminLike() {
    return ["admin", "manager"].includes(user().role);
  }

  function isNurseLike() {
    return ["nurse", "stock_operator"].includes(user().role);
  }

  function hasPermission(permission) {
    const current = user();
    return isAdminLike() || (current.permissions || []).includes(permission) ||
      (isNurseLike() && NURSE_PERMISSIONS.includes(permission));
  }

  function mobileWanted() {
    const params = new URLSearchParams(location.search);
    const stored = sessionStorage.getItem("keruikang-view-mode");
    if (params.get("mobile") === "1" || location.pathname.replace(/\/$/, "").endsWith("/mobile")) return true;
    if (isNurseLike()) return true;
    if (stored === "mobile") return true;
    if (stored === "desktop") return false;
    return isAdminLike() && window.matchMedia("(max-width: 767px)").matches;
  }

  function loggedIn() {
    return !!user().id && user().role !== "guest";
  }

  function showMobileShell() {
    if (!loggedIn() || !mobileWanted()) {
      document.body.classList.remove("mobile-nurse-mode");
      document.getElementById("mobileNurseApp")?.setAttribute("hidden", "");
      return;
    }
    document.body.classList.add("mobile-nurse-mode");
    document.getElementById("mobileNurseApp")?.removeAttribute("hidden");
    document.getElementById("loginScreen")?.classList.add("hidden");
    renderMobile();
  }

  function go(panel) {
    Object.entries(panelIds).forEach(([key, id]) => {
      document.getElementById(id)?.classList.toggle("active", key === panel);
    });
    document.querySelectorAll("[data-mobile-go]").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileGo === panel);
    });
    if (panel === "today") renderToday();
    if (panel === "mine") renderMine();
  }

  function currentStock(medicine) {
    return (medicine?.batches || []).reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
  }

  function medicineSubtitle(medicine) {
    return [medicine.spec, medicine.manufacturer, `库存 ${currentStock(medicine)} ${medicine.unit || ""}`]
      .filter(Boolean)
      .join(" · ");
  }

  function searchLocalMedicines(keyword) {
    const term = String(keyword || "").trim().toLowerCase();
    if (!term) return [];
    return (data.medicines || [])
      .filter(medicine => !medicine.disabled)
      .filter(medicine => JSON.stringify([
        medicine.name,
        medicine.code,
        medicine.internalCode,
        medicine.manufacturer,
        medicine.spec
      ]).toLowerCase().includes(term))
      .slice(0, 12);
  }

  function renderSearchResults(target, medicines, mode) {
    const box = document.getElementById(target);
    if (!box) return;
    box.innerHTML = medicines.map(medicine => `
      <button class="mobile-search-card" type="button" data-mobile-select-${mode}="${medicine.id}">
        <strong>${medicine.name}</strong>
        <span>${medicineSubtitle(medicine) || "暂无规格信息"}</span>
      </button>
    `).join("") || `<div class="mobile-selected-card"><span>没有找到药品，请先录入新药品。</span></div>`;
  }

  function selectedCard(medicine) {
    return `<strong>${medicine.name}</strong><span>${medicineSubtitle(medicine) || "已选择药品"}</span>`;
  }

  async function latestDraft(medicineId) {
    if (!window.KERUIKANG_CLOUD_INVENTORY?.getLatestBatchDraft) return null;
    try {
      return await window.KERUIKANG_CLOUD_INVENTORY.getLatestBatchDraft(medicineId);
    } catch (error) {
      console.warn("mobile batch draft read skipped", error);
      return null;
    }
  }

  async function selectInMedicine(medicine) {
    selectedInMedicine = medicine;
    document.getElementById("mobileInMedicineId").value = medicine.id;
    document.getElementById("mobileInSelected").hidden = false;
    document.getElementById("mobileInSelected").innerHTML = selectedCard(medicine);
    const form = document.getElementById("mobileStockInForm");
    form.elements.unit.value = medicine.unit || "盒";
    form.elements.retailPrice.value = medicine.salePrice || "";
    const note = document.getElementById("mobileInDraftNote");
    const draft = await latestDraft(medicine.id);
    if (draft) {
      form.elements.productionDate.value = draft.productionDate || form.elements.productionDate.value;
      form.elements.expiryDate.value = draft.expiryDate || form.elements.expiryDate.value;
      form.elements.unit.value = draft.unit || form.elements.unit.value || medicine.unit || "盒";
      form.elements.retailPrice.value = draft.retailPrice ?? form.elements.retailPrice.value;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function renderOutBatches() {
    const select = document.getElementById("mobileOutBatchSelect");
    const batches = (selectedOutMedicine?.batches || [])
      .filter(batch => Number(batch.quantity || 0) > 0)
      .sort((a, b) => new Date(a.expiryDate || "2999-12-31") - new Date(b.expiryDate || "2999-12-31"));
    select.innerHTML = batches.map(batch => {
      const value = batch.id || batch.batchNo;
      return `<option value="${value}">${batch.batchNo} · ${batch.expiryDate || "无效期"} · 库存 ${batch.quantity}</option>`;
    }).join("");
    updateOutBatch();
  }

  function updateOutBatch() {
    const value = document.getElementById("mobileOutBatchSelect")?.value || "";
    const batch = (selectedOutMedicine?.batches || []).find(item => (item.id || item.batchNo) === value);
    document.getElementById("mobileOutBatchId").value = batch?.id || "";
    document.getElementById("mobileOutBatchQty").textContent = batch ? `${batch.quantity} ${batch.unit || selectedOutMedicine.unit || ""}` : "-";
    document.getElementById("mobileOutBatchExpiry").textContent = batch?.expiryDate || "-";
  }

  function selectOutMedicine(medicine) {
    selectedOutMedicine = medicine;
    document.getElementById("mobileOutMedicineId").value = medicine.id;
    document.getElementById("mobileOutSelected").hidden = false;
    document.getElementById("mobileOutSelected").innerHTML = selectedCard(medicine);
    renderOutBatches();
  }

  async function refreshCloud() {
    if (window.KERUIKANG_CLOUD_INVENTORY?.refresh) await window.KERUIKANG_CLOUD_INVENTORY.refresh();
    renderMobile();
  }

  async function callRpc(name, payload) {
    if (!window.KERUIKANG_CLOUD_INVENTORY?.rpc) {
      throw new Error("云端库存组件未就绪，请刷新后重试。");
    }
    return window.KERUIKANG_CLOUD_INVENTORY.rpc(name, payload);
  }

  function requireChecked(form) {
    if (!form.elements.confirmed.checked) throw new Error("请先勾选核对确认。");
  }

  function positiveNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}必须大于 0。`);
    return Math.trunc(number);
  }

  function validDates(productionDate, expiryDate) {
    if (!productionDate || !expiryDate) throw new Error("请填写生产日期和有效期。");
    if (new Date(expiryDate) <= new Date(productionDate)) throw new Error("有效期必须晚于生产日期。");
  }

  function localStockIn(values) {
    const medicine = byId(values.medicineId);
    let batch = medicine.batches.find(item => item.batchNo === values.batchNumber && item.expiryDate === values.expiryDate);
    const quantity = positiveNumber(values.quantity, "入库数量");
    if (batch) batch.quantity += quantity;
    else {
      batch = {
        batchNo: values.batchNumber,
        productionDate: values.productionDate,
        expiryDate: values.expiryDate,
        quantity,
        unit: values.unit || medicine.unit || "盒"
      };
      medicine.batches.push(batch);
    }
    data.transactions.unshift({
      id: "t" + Date.now(),
      date: new Date().toISOString(),
      medicineId: medicine.id,
      batchNo: batch.batchNo,
      type: "in",
      quantity,
      balance: batch.quantity,
      operator: user().name,
      note: values.note || "护士手机端入库"
    });
    save();
    render();
  }

  function localStockOut(values, batch) {
    const quantity = positiveNumber(values.quantity, "出库数量");
    batch.quantity -= quantity;
    data.transactions.unshift({
      id: "t" + Date.now(),
      date: new Date().toISOString(),
      medicineId: selectedOutMedicine.id,
      batchNo: batch.batchNo,
      type: "out",
      quantity,
      balance: batch.quantity,
      operator: user().name,
      note: [values.reason, values.note].filter(Boolean).join(" - ")
    });
    save();
    render();
  }

  async function submitStockIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      if (!hasPermission("stock.in")) throw new Error("当前账号没有入库权限。");
      if (!selectedInMedicine || !values.medicineId) throw new Error("请先选择药品。");
      if (!String(values.batchNumber || "").trim()) throw new Error("请填写批号。");
      positiveNumber(values.quantity, "入库数量");
      validDates(values.productionDate, values.expiryDate);
      requireChecked(form);

      if (window.KERUIKANG_CLOUD_INVENTORY?.rpc) {
        await callRpc("rpc_mobile_stock_in_v1", {
          p_medicine_id: values.medicineId,
          p_quantity: positiveNumber(values.quantity, "入库数量"),
          p_batch_number: String(values.batchNumber).trim(),
          p_production_date: values.productionDate,
          p_expiry_date: values.expiryDate,
          p_unit: values.unit || selectedInMedicine.unit || "盒",
          p_retail_price: values.retailPrice ? Number(values.retailPrice) : null,
          p_note: values.note || "护士手机端入库"
        });
        await refreshCloud();
      } else {
        localStockIn(values);
      }
      toast("入库成功");
      form.reset();
      selectedInMedicine = null;
      document.getElementById("mobileInSelected").hidden = true;
      document.getElementById("mobileInDraftNote").hidden = true;
      renderToday();
    } catch (error) {
      toast("入库失败：" + error.message);
    }
  }

  async function submitStockOut(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const selectedValue = document.getElementById("mobileOutBatchSelect").value;
    const batch = (selectedOutMedicine?.batches || []).find(item => (item.id || item.batchNo) === selectedValue);
    try {
      if (!hasPermission("stock.out")) throw new Error("当前账号没有出库权限。");
      if (!selectedOutMedicine || !values.medicineId) throw new Error("请先选择药品。");
      if (!batch) throw new Error("请选择可用批次。");
      const quantity = positiveNumber(values.quantity, "出库数量");
      if (quantity > Number(batch.quantity || 0)) throw new Error("出库数量不能大于当前批次库存。");
      requireChecked(form);

      if (window.KERUIKANG_CLOUD_INVENTORY?.rpc) {
        if (!batch.id) throw new Error("该批次缺少云端 ID，请刷新库存后重试。");
        await callRpc("rpc_mobile_stock_out_v1", {
          p_medicine_id: values.medicineId,
          p_batch_id: batch.id,
          p_quantity: quantity,
          p_reason: values.reason || "发药",
          p_note: values.note || "护士手机端出库"
        });
        await refreshCloud();
      } else {
        localStockOut(values, batch);
      }
      toast("出库成功");
      form.reset();
      selectedOutMedicine = null;
      document.getElementById("mobileOutSelected").hidden = true;
      document.getElementById("mobileOutBatchSelect").innerHTML = "";
      updateOutBatch();
      renderToday();
    } catch (error) {
      toast("出库失败：" + error.message);
    }
  }

  function localCreateMedicine(values) {
    const medicine = {
      id: crypto.randomUUID(),
      name: values.name,
      code: "MED-MOB-" + Date.now(),
      category: values.category || "其他",
      spec: values.specification || "",
      manufacturer: values.manufacturer || "",
      unit: values.unit || "盒",
      minStock: Number(values.lowStockThreshold || 20),
      salePrice: Number(values.retailPrice || 0),
      disabled: false,
      batches: []
    };
    data.medicines.push(medicine);
    save();
    render();
    return medicine;
  }

  async function submitNewMedicine(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      if (!hasPermission("medicine.create") && !hasPermission("medicines.create")) {
        throw new Error("当前账号没有录入药品权限。");
      }
      const name = String(values.name || "").trim();
      if (!name) throw new Error("请填写药品名称。");
      const duplicate = (data.medicines || []).find(medicine =>
        medicine.name === name &&
        String(medicine.manufacturer || "") === String(values.manufacturer || "") &&
        String(medicine.spec || "") === String(values.specification || "")
      );
      if (duplicate && !confirm("该药品可能已存在，是否直接选择已有药品？")) return;

      let medicine = duplicate || null;
      if (!medicine) {
        if (window.KERUIKANG_CLOUD_INVENTORY?.createMedicineMaster) {
          const master = await window.KERUIKANG_CLOUD_INVENTORY.createMedicineMaster({
            name,
            manufacturer: values.manufacturer,
            category: values.category,
            specification: values.specification,
            defaultUnit: values.unit || "盒",
            retailPrice: values.retailPrice,
            lowStockThreshold: values.lowStockThreshold || 20
          });
          await refreshCloud();
          medicine = byId(master.id) || {
            id: master.id,
            name: master.name,
            code: master.internalCode,
            category: master.category,
            spec: master.spec,
            manufacturer: master.manufacturer,
            unit: master.unit,
            minStock: master.minStock,
            salePrice: master.salePrice,
            batches: []
          };
        } else {
          medicine = localCreateMedicine(values);
        }
      }

      toast("药品录入成功，请继续填写入库批次。");
      form.reset();
      form.elements.unit.value = "盒";
      form.elements.lowStockThreshold.value = "20";
      await selectInMedicine(medicine);
      go("in");
    } catch (error) {
      toast("录入失败：" + error.message);
    }
  }

  function renderToday() {
    const today = new Date().toISOString().slice(0, 10);
    const items = (data.transactions || [])
      .filter(item => String(item.date || "").slice(0, 10) === today)
      .filter(item => !user().name || item.operator === user().name || isAdminLike())
      .slice(0, 20);
    const box = document.getElementById("mobileTodayList");
    box.innerHTML = items.map(item => {
      const medicine = byId(item.medicineId);
      return `<div class="mobile-record-card">
        <strong>${item.type === "in" ? "入库" : "出库"} · ${medicine?.name || "药品"}</strong>
        <span>批号 ${item.batchNo || "-"} · 数量 ${item.quantity} · ${fmtTime(item.date)}</span>
      </div>`;
    }).join("") || `<div class="mobile-selected-card"><span>今天还没有入库/出库记录。</span></div>`;
  }

  function renderMine() {
    const current = user();
    document.getElementById("mobileCurrentUserName").textContent = current.name || "未登录";
    document.getElementById("mobileCurrentUserRole").textContent = isAdminLike() ? "管理员" : "护士工作台";
  }

  function renderMobile() {
    if (!loggedIn()) return;
    document.getElementById("mobileAdminChoice").hidden = !isAdminLike();
    renderToday();
    renderMine();
  }

  document.addEventListener("click", event => {
    const goButton = event.target.closest("[data-mobile-go]");
    if (goButton) go(goButton.dataset.mobileGo);

    const inSelect = event.target.closest("[data-mobile-select-in]");
    if (inSelect) {
      const medicine = byId(inSelect.dataset.mobileSelectIn);
      if (medicine) selectInMedicine(medicine);
    }

    const outSelect = event.target.closest("[data-mobile-select-out]");
    if (outSelect) {
      const medicine = byId(outSelect.dataset.mobileSelectOut);
      if (medicine) selectOutMedicine(medicine);
    }
  });

  document.getElementById("mobileInSearch")?.addEventListener("input", event => {
    renderSearchResults("mobileInResults", searchLocalMedicines(event.target.value), "in");
  });

  document.getElementById("mobileOutSearch")?.addEventListener("input", event => {
    renderSearchResults("mobileOutResults", searchLocalMedicines(event.target.value), "out");
  });

  document.getElementById("mobileOutBatchSelect")?.addEventListener("change", updateOutBatch);
  document.getElementById("mobileStockInForm")?.addEventListener("submit", submitStockIn);
  document.getElementById("mobileStockOutForm")?.addEventListener("submit", submitStockOut);
  document.getElementById("mobileNewMedicineForm")?.addEventListener("submit", submitNewMedicine);

  document.getElementById("mobileUseDesktop")?.addEventListener("click", () => {
    sessionStorage.setItem("keruikang-view-mode", "desktop");
    document.body.classList.remove("mobile-nurse-mode");
    document.getElementById("mobileNurseApp")?.setAttribute("hidden", "");
  });
  document.getElementById("mobileUseNurse")?.addEventListener("click", () => {
    sessionStorage.setItem("keruikang-view-mode", "mobile");
    showMobileShell();
  });
  document.getElementById("mobileChangePassword")?.addEventListener("click", () => {
    document.getElementById("changePasswordBtn")?.click();
  });
  document.getElementById("mobileSwitchAccount")?.addEventListener("click", () => {
    window.forceSignOutAndShowLogin?.("switch_account");
  });
  document.getElementById("mobileLogout")?.addEventListener("click", () => {
    window.forceSignOutAndShowLogin?.("logout");
  });

  const baseRender = window.render;
  if (typeof baseRender === "function") {
    window.render = function () {
      baseRender.apply(this, arguments);
      showMobileShell();
    };
  }

  window.addEventListener("resize", showMobileShell);
  setTimeout(showMobileShell, 0);
  window.KERUIKANG_MOBILE_NURSE = { show: showMobileShell, go, nursePermissions: NURSE_PERMISSIONS };
})();
