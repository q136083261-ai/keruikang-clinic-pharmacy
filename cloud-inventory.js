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
        throw new Error("数据库 RPC 还没有安装，请先在 Supabase 执行最新 migration SQL");
      }
      throw error;
    }
    return result || [];
  }

  function readLookupResult(form) {
    try {
      return JSON.parse(form?.dataset?.lookupResult || "{}") || {};
    } catch {
      return {};
    }
  }

  function buildTraceInboundPayload(values, form, forcedMedicineId = "") {
    const lookupResult = readLookupResult(form);
    const selectedMedicineId = values.selectedMedicineId || form?.dataset?.selectedMedicineId || "";
    const existingMedicine = byId(values.medicineId || forcedMedicineId || selectedMedicineId);
    const rawCode = values.barcode || values.stockBarcode || lookupResult.rawCode || "";
    return {
      rawCode,
      lookupResult: {
        ...lookupResult,
        rawCode: lookupResult.rawCode || rawCode,
        traceCode: lookupResult.traceCode || form?.dataset?.traceCode || "",
        medicineId: lookupResult.medicineId || forcedMedicineId || values.medicineId || selectedMedicineId || ""
      },
      confirmedFields: {
        medicineId: forcedMedicineId || values.medicineId || selectedMedicineId || lookupResult.medicineId || "",
        drugName: values.name || lookupResult.drugName || existingMedicine?.name || "",
        name: values.name || lookupResult.drugName || existingMedicine?.name || "",
        approvalNo: values.code || lookupResult.approvalNo || existingMedicine?.code || "",
        code: values.code || lookupResult.approvalNo || existingMedicine?.code || "",
        manufacturer: values.manufacturer || lookupResult.manufacturer || existingMedicine?.manufacturer || "",
        category: values.category || existingMedicine?.category || "",
        packageSpec: values.spec || lookupResult.packageSpec || existingMedicine?.spec || "",
        spec: values.spec || lookupResult.packageSpec || existingMedicine?.spec || "",
        unit: values.unit || existingMedicine?.unit || "盒",
        retailPrice: values.salePrice || existingMedicine?.salePrice || "",
        stockWarning: values.minStock || existingMedicine?.minStock || 20,
        batchNo: values.batchNo,
        productionDate: values.productionDate,
        expiryDate: values.expiryDate,
        expiryPrecision: values.expiryPrecision || "day",
        quantity: values.quantity,
        barcode: rawCode
      },
      userConfirmed: values.scanConfirmed === "on" || values.stockScanConfirmed === "on" || !rawCode
    };
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
    try {
      const { data: drafts, error: draftError } = await client
        .from("medicine_batch_drafts")
        .select("id,medicine_id,internal_code,name,manufacturer,batch_no,production_date,production_precision,expiry_date,expiry_precision,quantity,unit,retail_price,review_notes,source,used_for_inbound")
        .order("expiry_date", { ascending: false, nullsFirst: false });
      if (!draftError) {
        const latestDraftByMedicine = new Map();
        (drafts || []).forEach(draft => {
          if (!draft.medicine_id || latestDraftByMedicine.has(draft.medicine_id)) return;
          latestDraftByMedicine.set(draft.medicine_id, mapBatchDraft(draft));
        });
        data.medicines.forEach(medicine => {
          medicine.batchDraft = latestDraftByMedicine.get(medicine.id) || null;
        });
      }
    } catch (error) {
      console.warn("medicine_batch_drafts optional read skipped", error);
    }
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

  function mapMedicineMaster(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || "",
      code: row.internal_code || row.approval_number || "",
      internalCode: row.internal_code || "",
      approvalNo: row.approval_number || "",
      category: row.category || "其他",
      spec: row.specification || "",
      unit: row.default_unit || "盒",
      manufacturer: row.manufacturer || "",
      salePrice: Number(row.retail_price || 0),
      minStock: Number(row.low_stock_threshold || 0),
      disabled: row.active === false,
      source: "local_medicine_master"
    };
  }

  function mapBatchDraft(row) {
    if (!row) return null;
    return {
      id: row.id,
      medicineId: row.medicine_id || "",
      internalCode: row.internal_code || "",
      name: row.name || "",
      manufacturer: row.manufacturer || "",
      batchNo: row.batch_no || "",
      productionDate: row.production_date || "",
      productionPrecision: row.production_precision || "",
      expiryDate: row.expiry_date || "",
      expiryPrecision: row.expiry_precision || "",
      quantity: row.quantity ?? "",
      unit: row.unit || "",
      retailPrice: row.retail_price ?? "",
      reviewNotes: row.review_notes || "",
      source: row.source || "excel_import_review",
      usedForInbound: row.used_for_inbound === true
    };
  }

  async function searchMedicineMasters(keyword) {
    if (!client || !keyword || String(keyword).trim().length < 1) return [];
    const term = String(keyword).trim().replace(/[%_,]/g, "");
    const { data: rows, error } = await client
      .from("medicines")
      .select("id,internal_code,name,manufacturer,category,specification,default_unit,retail_price,low_stock_threshold,active")
      .or(`name.ilike.%${term}%,manufacturer.ilike.%${term}%,internal_code.ilike.%${term}%`)
      .eq("active", true)
      .order("internal_code")
      .limit(20);
    if (error) throw error;
    return (rows || []).map(mapMedicineMaster);
  }

  async function findMedicineByMapping(codeType, codeValue) {
    if (!client || !codeType || !codeValue) return null;
    const { data: row, error } = await client
      .from("medicine_code_mappings")
      .select("medicine_id,code_type,code_value,medicines(id,internal_code,name,manufacturer,category,specification,default_unit,retail_price,low_stock_threshold,active)")
      .eq("code_type", codeType)
      .eq("code_value", String(codeValue))
      .maybeSingle();
    if (error) throw error;
    return mapMedicineMaster(row?.medicines);
  }

  async function getLatestBatchDraft(medicineId) {
    if (!client || !medicineId) return null;
    const { data: row, error } = await client
      .from("medicine_batch_drafts")
      .select("id,medicine_id,internal_code,name,manufacturer,batch_no,production_date,production_precision,expiry_date,expiry_precision,quantity,unit,retail_price,review_notes,source,used_for_inbound")
      .eq("medicine_id", medicineId)
      .order("expiry_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (/does not exist|schema cache/i.test(error.message || "")) return null;
      throw error;
    }
    return mapBatchDraft(row);
  }

  async function upsertMedicineMapping({ medicineId, codeType, codeValue, source = "manual_confirmed", confidence = 1 }) {
    if (!client || !medicineId || !codeType || !codeValue) return null;
    const user = await signedInUser();
    const { data: row, error } = await client
      .from("medicine_code_mappings")
      .upsert({
        medicine_id: medicineId,
        code_type: codeType,
        code_value: String(codeValue),
        source,
        confidence,
        created_by: user?.id || null
      }, { onConflict: "code_type,code_value" })
      .select()
      .single();
    if (error) throw error;
    return row;
  }

  async function createMedicineWithInitialStock(values, form) {
    assertDates(values.productionDate, values.expiryDate);
    assertPositiveQuantity(values.quantity);

    const inbound = await rpc("rpc_trace_inbound", {
      p_payload: buildTraceInboundPayload(values, form)
    });
    const medicineId = inbound?.[0]?.medicine_id;
    if (!medicineId) throw new Error("云端入库成功但未返回药品 ID");

    const lookupResult = readLookupResult(form);
    const selectedMedicineId = values.selectedMedicineId || form?.dataset?.selectedMedicineId || "";
    const productResourceCode = lookupResult.productResourceCode || form?.dataset?.productResourceCode || "";
    if (selectedMedicineId && productResourceCode) {
      await upsertMedicineMapping({
        medicineId: selectedMedicineId,
        codeType: "trace_product_code",
        codeValue: productResourceCode,
        source: "manual_confirmed",
        confidence: 1
      });
    }

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
      await createMedicineWithInitialStock(values, event.target);
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
        if (values.stockBarcode) {
          await rpc("rpc_trace_inbound", {
            p_payload: buildTraceInboundPayload(values, event.target, values.medicineId)
          });
        } else {
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
        }
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
    rpc,
    searchMedicineMasters,
    findMedicineByMapping,
    getLatestBatchDraft,
    upsertMedicineMapping
  };
})();
