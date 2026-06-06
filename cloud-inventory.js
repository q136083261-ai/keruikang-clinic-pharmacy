(function () {
  const config = window.CLINIC_SUPABASE;
  const canUseSupabase = !!(config && window.supabase);
  const client = canUseSupabase
    ? window.supabase.createClient(config.url, config.publishableKey)
    : null;
  let cloudSignedIn = false;

  if (client) {
    client.auth.getSession().then(({ data }) => {
      cloudSignedIn = !!data.session;
    });
    client.auth.onAuthStateChange((_event, session) => {
      cloudSignedIn = !!session;
    });
  }

  function money(value) {
    return Number(value || 0);
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form));
  }

  function cloudToast(message) {
    if (typeof toast === "function") toast(message);
  }

  async function signedInUser() {
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data?.user || null;
  }

  function cloudMode() {
    return cloudSignedIn;
  }

  function assertPositiveQuantity(quantity) {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("数量必须大于 0");
    }
    return Math.trunc(value);
  }

  function assertDates(productionDate, expiryDate) {
    if (!productionDate || !expiryDate) throw new Error("请填写生产日期和有效期");
    if (new Date(expiryDate) <= new Date(productionDate)) {
      throw new Error("有效期必须晚于生产日期");
    }
  }

  function batchIdFromKey(batchKey) {
    const [medicineId, batchNo] = String(batchKey || "").split("::");
    const medicine = byId(medicineId);
    const batch = medicine?.batches?.find(item => item.batchNo === batchNo);
    return { medicine, batch };
  }

  async function rpc(name, payload) {
    const { data: result, error } = await client.rpc(name, payload);
    if (error) {
      if (/function .* does not exist/i.test(error.message || "")) {
        throw new Error("数据库 RPC 还没有安装，请先在 Supabase 执行 migration-03 SQL");
      }
      throw error;
    }
    return result || [];
  }

  function mapMedicine(medicine, batches) {
    return {
      id: medicine.id,
      name: medicine.name,
      code: medicine.approval_number || "",
      barcode: medicine.barcode || "",
      category: medicine.category || "其他",
      spec: medicine.specification || "",
      manufacturer: medicine.manufacturer || "",
      minStock: Number(medicine.low_stock_threshold || 0),
      unit: medicine.default_unit || "盒",
      dispenseUnit: medicine.default_unit || "盒",
      conversion: 1,
      location: medicine.location || "药房默认库位",
      salePrice: Number(medicine.retail_price || 0),
      warningDays: data.settings?.expiryWarningDays || 90,
      disabled: medicine.active === false,
      publicVisible: false,
      batches: batches
        .filter(batch => batch.medicine_id === medicine.id)
        .map(batch => ({
          id: batch.id,
          batchNo: batch.batch_number,
          productionDate: batch.production_date || "",
          expiryDate: batch.expiry_date,
          quantity: Number(batch.quantity || 0),
          unit: batch.unit || medicine.default_unit || "盒",
          location: batch.location || ""
        }))
    };
  }

  async function refreshCloudInventory() {
    const [
      { data: medicines, error: medicineError },
      { data: batches, error: batchError },
      { data: movements, error: movementError },
      { data: catalog }
    ] = await Promise.all([
      client.from("medicines").select("*").order("created_at"),
      client.from("inventory_batches").select("*").order("created_at"),
      client.from("inventory_movements").select("*").order("created_at", { ascending: false }).limit(300),
      client.from("public_catalog").select("medicine_id,visible")
    ]);

    if (medicineError) throw medicineError;
    if (batchError) throw batchError;
    if (movementError) throw movementError;

    data.medicines = (medicines || []).map(medicine => mapMedicine(medicine, batches || []));
    const catalogMap = new Map((catalog || []).map(item => [item.medicine_id, item.visible]));
    data.medicines.forEach(medicine => {
      medicine.publicVisible = catalogMap.get(medicine.id) === true;
    });

    data.transactions = (movements || []).map(movement => ({
      id: movement.id,
      date: movement.created_at,
      medicineId: movement.medicine_id,
      batchNo: movement.batch_number,
      type: movement.movement_type === "in" ? "in" : "out",
      quantity: Math.abs(Number(movement.quantity || 0)),
      balance: Number(movement.balance || 0),
      operator: currentUser?.().name || "云端用户",
      note: movement.note || movement.movement_type
    }));

    localStorage.setItem(storeKey, JSON.stringify(data));
    render();
  }

  async function createMedicineWithInitialStock(values) {
    assertDates(values.productionDate, values.expiryDate);
    const quantity = assertPositiveQuantity(values.quantity);
    const user = await signedInUser();
    const medicineId = crypto.randomUUID();

    const { error: medicineError } = await client.from("medicines").insert({
      id: medicineId,
      name: values.name,
      barcode: values.barcode || null,
      category: values.category || null,
      specification: values.spec || null,
      manufacturer: values.manufacturer || null,
      approval_number: values.code || null,
      default_unit: values.unit || "盒",
      retail_price: money(values.salePrice),
      low_stock_threshold: Number(values.minStock || 0),
      active: true,
      created_by: user.id
    });
    if (medicineError) throw medicineError;

    await rpc("rpc_stock_in", {
      p_medicine_id: medicineId,
      p_batch_number: values.batchNo,
      p_quantity: quantity,
      p_production_date: values.productionDate,
      p_expiry_date: values.expiryDate,
      p_unit: values.unit || "盒",
      p_location: "药房默认库位",
      p_note: "首次录入"
    });

    await client.from("public_catalog").upsert({
      medicine_id: medicineId,
      display_name: values.name,
      category: values.category || null,
      specification: values.spec || null,
      manufacturer: values.manufacturer || null,
      retail_price: money(values.salePrice),
      unit: values.unit || "盒",
      stock_status: "有货",
      expiry_notice: `在售批次有效期至 ${values.expiryDate}`,
      visible: false
    }, { onConflict: "medicine_id" });
  }

  async function submitMedicineCloud(event) {
    if (!cloudMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (window.KERUIKANG_VALIDATE_SCAN_BEFORE_SAVE &&
        !window.KERUIKANG_VALIDATE_SCAN_BEFORE_SAVE(event.target, "medicine")) return;

    try {
      const values = formValues(event.target);
      await createMedicineWithInitialStock(values);
      await refreshCloudInventory();
      event.target.reset();
      closeModals();
      cloudToast("药品已通过云端事务录入");
    } catch (error) {
      console.error(error);
      cloudToast("云端录入失败：" + error.message);
    }
  }

  async function submitStockCloud(event) {
    if (!cloudMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const stockType = new FormData(event.target).get("type");
    if (stockType === "in" && window.KERUIKANG_VALIDATE_SCAN_BEFORE_SAVE &&
        !window.KERUIKANG_VALIDATE_SCAN_BEFORE_SAVE(event.target, "stock")) return;

    try {
      const values = formValues(event.target);
      const quantity = assertPositiveQuantity(values.quantity);
      if (values.type === "in") {
        assertDates(values.productionDate, values.expiryDate);
        await rpc("rpc_stock_in", {
          p_medicine_id: values.medicineId,
          p_batch_number: values.batchNo,
          p_quantity: quantity,
          p_production_date: values.productionDate,
          p_expiry_date: values.expiryDate,
          p_unit: byId(values.medicineId)?.unit || "盒",
          p_location: byId(values.medicineId)?.location || "药房默认库位",
          p_note: values.note || "扫码/手动入库"
        });
      } else {
        await rpc("rpc_stock_out", {
          p_medicine_id: values.medicineId,
          p_quantity: quantity,
          p_note: values.note || "出库登记"
        });
      }

      await refreshCloudInventory();
      event.target.reset();
      document.getElementById("batchFields").style.display = "block";
      closeModals();
      cloudToast(values.type === "in" ? "云端入库成功" : "云端出库成功");
    } catch (error) {
      console.error(error);
      cloudToast("库存事务失败：" + error.message);
    }
  }

  async function submitPurchaseCloud(event) {
    if (!cloudMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const values = formValues(event.target);
      assertDates(values.productionDate, values.expiryDate);
      await rpc("rpc_stock_in", {
        p_medicine_id: values.medicineId,
        p_batch_number: values.batchNo,
        p_quantity: assertPositiveQuantity(values.quantity),
        p_production_date: values.productionDate,
        p_expiry_date: values.expiryDate,
        p_unit: byId(values.medicineId)?.unit || "盒",
        p_location: byId(values.medicineId)?.location || "药房默认库位",
        p_note: "采购入库"
      });
      await refreshCloudInventory();
      event.target.reset();
      closeModals();
      cloudToast("采购已通过云端事务入库");
    } catch (error) {
      console.error(error);
      cloudToast("采购入库失败：" + error.message);
    }
  }

  async function submitCountCloud(event) {
    if (!cloudMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const values = formValues(event.target);
      const { batch } = batchIdFromKey(values.batchKey);
      if (!batch?.id) throw new Error("未找到云端批次 ID，请刷新后重试");
      await rpc("rpc_stock_count", {
        p_batch_id: batch.id,
        p_actual_quantity: Number(values.actual),
        p_note: values.note || "库存盘点"
      });
      await refreshCloudInventory();
      event.target.reset();
      closeModals();
      cloudToast("盘点已通过云端事务完成");
    } catch (error) {
      console.error(error);
      cloudToast("云端盘点失败：" + error.message);
    }
  }

  async function submitDisposalCloud(event) {
    if (!cloudMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const values = formValues(event.target);
      const { batch } = batchIdFromKey(values.batchKey);
      if (!batch?.id) throw new Error("未找到云端批次 ID，请刷新后重试");
      await rpc("rpc_stock_dispose", {
        p_batch_id: batch.id,
        p_quantity: assertPositiveQuantity(values.quantity),
        p_reason: values.reason || "报损",
        p_note: values.note || ""
      });
      await refreshCloudInventory();
      event.target.reset();
      closeModals();
      cloudToast("报损已通过云端事务完成");
    } catch (error) {
      console.error(error);
      cloudToast("云端报损失败：" + error.message);
    }
  }

  function attach(formId, handler) {
    const form = document.getElementById(formId);
    if (form) form.addEventListener("submit", handler, true);
  }

  attach("medicineForm", submitMedicineCloud);
  attach("stockForm", submitStockCloud);
  attach("purchaseForm", submitPurchaseCloud);
  attach("countForm", submitCountCloud);
  attach("disposalForm", submitDisposalCloud);

  window.KERUIKANG_CLOUD_INVENTORY = {
    refresh: refreshCloudInventory,
    rpc
  };
})();
