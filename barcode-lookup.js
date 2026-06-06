const medicineEntryForm = document.getElementById("medicineForm");
const stockEntryForm = document.getElementById("stockForm");
const medicineBarcodeInput = document.getElementById("medicineBarcode");
const stockBarcodeInput = document.getElementById("stockBarcode");
const lookupResult = document.getElementById("lookupResult");
const stockLookupResult = document.getElementById("stockLookupResult");

const demoBarcodeCatalog = {
  "6937835110193": {
    name: "\u5421\u7f57\u6614\u5eb7\u7247",
    code: "\u56fd\u836f\u51c6\u5b57H50020656",
    category: "\u897f\u836f",
    spec: "0.02g x 100\u7247",
    unit: "\u74f6",
    manufacturer: "\u91cd\u5e86\u548c\u5e73\u5236\u836f\u6709\u9650\u516c\u53f8",
    minStock: 20,
    salePrice: 12.8
  },
  "6901234567892": {
    name: "\u7ef4\u751f\u7d20C\u7247",
    code: "\u56fd\u836f\u51c6\u5b57H44020019",
    category: "\u897f\u836f",
    spec: "100mg x 100\u7247",
    unit: "\u74f6",
    manufacturer: "\u793a\u4f8b\u5236\u836f\u6709\u9650\u516c\u53f8",
    minStock: 20,
    salePrice: 8.5
  },
  "6970000000018": {
    name: "\u4e00\u6b21\u6027\u65e0\u83cc\u6ce8\u5c04\u5668",
    code: "\u68b0\u6ce8\u51c6\u793a\u4f8b01",
    category: "\u533b\u7597\u8017\u6750",
    spec: "5ml x 1\u652f",
    unit: "\u652f",
    manufacturer: "\u793a\u4f8b\u533b\u7597\u5668\u68b0\u6709\u9650\u516c\u53f8",
    minStock: 50,
    salePrice: 1.5
  }
};

function normalizeBarcode(raw) {
  return String(raw || "").trim().replace(/[()]/g, "").replace(/\s+/g, "");
}

function compactDate(value) {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (digits.length === 6) {
    const year2 = Number(digits.slice(0, 2));
    const year = year2 >= 50 ? 1900 + year2 : 2000 + year2;
    const day = digits.slice(4, 6) === "00" ? "01" : digits.slice(4, 6);
    return `${year}-${digits.slice(2, 4)}-${day}`;
  }
  return "";
}

function splitGs1(raw) {
  const text = String(raw || "").trim();
  const cleaned = text.replace(/[()]/g, "");
  const groupSep = String.fromCharCode(29);
  const parsed = {
    raw: text,
    barcode: cleaned,
    gtin: "",
    batchNo: "",
    productionDate: "",
    expiryDate: "",
    serialNo: "",
    quantity: "",
    traceDrugCode: "",
    traceSerialNo: "",
    traceFullCode: ""
  };
  let i = 0;

  while (i < cleaned.length) {
    const ai = cleaned.slice(i, i + 2);
    if (ai === "01") {
      parsed.gtin = cleaned.slice(i + 2, i + 16);
      i += 16;
      continue;
    }
    if (ai === "11") {
      parsed.productionDate = compactDate(cleaned.slice(i + 2, i + 8));
      i += 8;
      continue;
    }
    if (ai === "17") {
      parsed.expiryDate = compactDate(cleaned.slice(i + 2, i + 8));
      i += 8;
      continue;
    }
    if (ai === "30") {
      const match = cleaned.slice(i + 2).match(/^\d{1,8}/);
      parsed.quantity = match ? match[0] : "";
      i += 2 + (match ? match[0].length : 0);
      continue;
    }
    if (ai === "10" || ai === "21") {
      const rest = cleaned.slice(i + 2);
      const sep = rest.indexOf(groupSep);
      const segment = sep >= 0 ? rest.slice(0, sep) : rest;
      const nextAi = segment.search(/(?:11|17|30)\d{6}/);
      const value = nextAi > 0 ? segment.slice(0, nextAi) : segment;
      if (ai === "10") parsed.batchNo = value.replace(groupSep, "");
      if (ai === "21") parsed.serialNo = value.replace(groupSep, "");
      i = nextAi > 0 ? i + 2 + nextAi : sep >= 0 ? i + 2 + sep + 1 : cleaned.length;
      continue;
    }
    i++;
  }

  if (parsed.gtin) parsed.barcode = parsed.gtin;
  return parsed;
}

function parseChinaTraceCode(raw, parsed) {
  const text = String(raw || "");
  const normalized = normalizeBarcode(raw);
  const marked = text.match(/(?:\u836f\u54c1\u6807\u8bc6\u7801|drug\s*code)\D*(\d{5,14})\D+(?:\u5e8f\u5217\u53f7|serial)\D*(\d{6,24})/i);

  if (marked) {
    parsed.traceDrugCode = marked[1];
    parsed.traceSerialNo = marked[2];
    parsed.traceFullCode = `${marked[1]}${marked[2]}`;
  } else if (!parsed.gtin && !parsed.batchNo && /^\d{18,26}$/.test(normalized)) {
    parsed.traceDrugCode = normalized.slice(0, 7);
    parsed.traceSerialNo = normalized.slice(7);
    parsed.traceFullCode = normalized;
    parsed.gtin = "";
    parsed.batchNo = "";
    parsed.productionDate = "";
    parsed.expiryDate = "";
    parsed.quantity = "";
  } else if (!parsed.gtin && !parsed.batchNo && /^8\d{6}$/.test(normalized)) {
    parsed.traceDrugCode = normalized;
  }

  if (parsed.traceDrugCode) {
    parsed.barcode = parsed.traceDrugCode;
    parsed.serialNo = parsed.traceSerialNo || parsed.serialNo;
  }
  return parsed;
}

function parseBarcode(raw) {
  const normalized = normalizeBarcode(raw);
  const parsed = parseChinaTraceCode(raw, splitGs1(raw));

  if (!parsed.gtin && !parsed.traceDrugCode && /^\d{8,14}$/.test(normalized)) {
    parsed.gtin = normalized;
    parsed.barcode = normalized;
  }

  const common = normalized.match(/^(\d{8,14})[-|_ ]?([A-Za-z0-9.-]{3,30})?[-|_ ]?((?:20)?\d{2}[01]\d[0-3]\d)?$/);
  if (!parsed.gtin && !parsed.traceDrugCode && common) {
    parsed.gtin = common[1];
    parsed.barcode = common[1];
    if (common[2]) parsed.batchNo = common[2];
    if (common[3]) parsed.expiryDate = compactDate(common[3]);
  }
  return parsed;
}

function setField(form, name, value) {
  if (value === undefined || value === null || value === "") return;
  const field = form.elements[name];
  if (!field) return;
  if (field.tagName === "SELECT") {
    const exists = [...field.options].some(option => option.value === String(value) || option.textContent === String(value));
    if (!exists) field.add(new Option(String(value), String(value)));
  }
  field.value = String(value);
}

function requiredMissing(form, names) {
  return names.filter(name => !String(form.elements[name]?.value || "").trim());
}

function labelFor(name) {
  return ({
    name: "\u836f\u54c1\u540d\u79f0",
    code: "\u836f\u54c1\u7f16\u7801",
    spec: "\u89c4\u683c",
    unit: "\u5355\u4f4d",
    batchNo: "\u6279\u53f7",
    productionDate: "\u751f\u4ea7\u65e5\u671f",
    expiryDate: "\u6709\u6548\u671f",
    quantity: "\u6570\u91cf",
    medicineId: "\u836f\u54c1"
  }[name] || name);
}

function scanStatus(form, type, item, parsed) {
  const drugMissing = type === "medicine" ? requiredMissing(form, ["name", "code", "spec", "unit"]) : [];
  const batchMissing = requiredMissing(form, ["batchNo", "productionDate", "expiryDate", "quantity"]);
  const hasDrug = item?.name || type === "stock";
  const hasBatch = parsed.batchNo || parsed.productionDate || parsed.expiryDate;
  const hasTrace = parsed.traceDrugCode || parsed.traceSerialNo;

  if (!hasDrug && !hasBatch && hasTrace) {
    return {
      state: "manual",
      title: "\u836f\u54c1\u8ffd\u6eaf\u7801\u5df2\u89e3\u6790",
      detail: "\u5df2\u8bc6\u522b\u836f\u54c1\u6807\u8bc6\u7801\u548c\u5e8f\u5217\u53f7\uff0c\u4f46\u666e\u901a\u836f\u54c1\u5e93\u65e0\u6cd5\u76f4\u63a5\u7528\u8ffd\u6eaf\u7801\u8fd4\u56de\u836f\u540d\u3002\u8bf7\u62cd\u5305\u542b\u201c\u56fd\u836f\u51c6\u5b57/\u836f\u540d\u201d\u7684\u5305\u88c5\u6b63\u9762\uff0c\u6216\u914d\u7f6e\u6388\u6743\u8ffd\u6eaf\u5e73\u53f0\u63a5\u53e3\u540e\u518d\u81ea\u52a8\u5339\u914d\u3002"
    };
  }
  if (!hasDrug && !hasBatch) {
    return {
      state: "manual",
      title: "\u65b0\u6761\u7801\u5f85\u5efa\u6863",
      detail: "\u672a\u5339\u914d\u5230\u836f\u54c1\u8d44\u6599\u3002\u8bf7\u6309\u5305\u88c5\u624b\u52a8\u8865\u5f55\uff0c\u4fdd\u5b58\u540e\u8be5\u6761\u7801\u4f1a\u7ed1\u5b9a\u5230\u836f\u54c1\u6863\u6848\u3002"
    };
  }
  if (drugMissing.length || batchMissing.length) {
    return {
      state: "warn",
      title: "\u9700\u8981\u4eba\u5de5\u8865\u5168",
      detail: `\u7f3a\u5c11\uff1a${[...drugMissing, ...batchMissing].map(labelFor).join("\u3001")}\u3002\u8865\u5168\u5e76\u6838\u5bf9\u540e\u53ef\u4ee5\u4fdd\u5b58\u3002`
    };
  }
  return {
    state: "success",
    title: "\u5b8c\u6574\u8bc6\u522b",
    detail: "\u836f\u54c1\u8d44\u6599\u548c\u6279\u6b21\u5173\u952e\u5b57\u6bb5\u5df2\u586b\u5165\uff0c\u8bf7\u6309\u5305\u88c5\u518d\u6838\u5bf9\u4e00\u6b21\u3002"
  };
}

function setScanState(form, resultBox, status) {
  form.dataset.scanState = status.state;
  resultBox.dataset.scanState = status.state;
  return status;
}

function resultHtml(cls, title, lines) {
  return `<div class="${cls}"><strong>${title}</strong>${lines.map(line => `<span>${line}</span>`).join("")}</div>`;
}

function isFullTraceCode(parsed, rawBarcode = "") {
  const trace = parsed?.traceFullCode || normalizeBarcode(rawBarcode || "");
  return /^8\d{19}$/.test(trace);
}

function traceLookupErrorMessage(error) {
  if (error?.errorCode === "CONFIG_MISSING") {
    return {
      title: "外部追溯接口未配置",
      lines: [
        "已识别为完整药品追溯码，但外部追溯接口未返回药品资料。",
        "请检查码上放心/阿里健康 AppKey、Secret、ref_ent_id 配置，或使用包装照片识别兜底。",
        `错误码：${error.errorCode}`
      ]
    };
  }
  return {
    title: "外部追溯接口未返回药品资料",
    lines: [
      "已识别为完整药品追溯码，但外部查询没有返回可自动填入的药品资料。",
      error?.message ? `接口信息：${error.message}` : "可使用包装照片识别兜底，并在人工确认后建立本地药品主档。",
      error?.errorCode ? `错误码：${error.errorCode}` : ""
    ].filter(Boolean)
  };
}

function traceLookupKeys(parsed, rawBarcode) {
  const keys = [
    parsed.traceDrugCode,
    parsed.traceFullCode,
    parsed.gtin,
    parsed.barcode,
    rawBarcode
  ].filter(Boolean);
  return [...new Set(keys)];
}

function traceCodeFor(parsed, rawBarcode) {
  return parsed?.traceFullCode || parsed?.traceDrugCode || normalizeBarcode(rawBarcode || "");
}

function setLookupState(form, parsed, item = {}, source = "", cloudStatus = null) {
  const lookup = {
    rawCode: parsed.raw || "",
    codeType: cloudStatus?.code_type || (isFullTraceCode(parsed) ? "MSFX_20" : parsed.traceFullCode ? "MSFX_TRACE" : parsed.gtin ? "GS1_OR_EAN" : "UNKNOWN"),
    traceCode: item.traceCode || parsed.traceFullCode || "",
    productResourceCode: item.productResourceCode || cloudStatus?.product_resource_code || parsed.traceDrugCode || "",
    serialNo: item.serialNo || cloudStatus?.serial_no || parsed.traceSerialNo || parsed.serialNo || "",
    medicineId: cloudStatus?.medicine_id || item.id || "",
    externalSource: item.externalSource || source,
    externalDrugId: item.externalDrugId || "",
    codeStatus: item.codeStatus || "",
    packageLevel: item.packageLevel || "",
    drugName: item.name || cloudStatus?.drug_name || "",
    approvalNo: item.code || item.approvalNo || cloudStatus?.approval_no || "",
    manufacturer: item.manufacturer || cloudStatus?.manufacturer || "",
    packageSpec: item.spec || cloudStatus?.package_spec || "",
    batchNo: parsed.batchNo || item.batchNo || "",
    productionDate: parsed.productionDate || item.productionDate || "",
    expiryDate: parsed.expiryDate || item.expiryDate || "",
    duplicate: !!cloudStatus?.duplicate,
    existingTraceCodeId: cloudStatus?.existing_trace_code_id || ""
  };
  form.dataset.lookupResult = JSON.stringify(lookup);
  form.dataset.traceCode = lookup.traceCode;
  form.dataset.productResourceCode = lookup.productResourceCode;
  form.dataset.serialNo = lookup.serialNo;
  form.dataset.cloudMedicineId = lookup.medicineId;
  form.dataset.duplicateTrace = lookup.duplicate ? "true" : "";
  return lookup;
}

async function checkCloudTrace(parsed, rawBarcode) {
  const traceCode = parsed.traceFullCode || (/^8\d{19}$/.test(normalizeBarcode(rawBarcode)) ? normalizeBarcode(rawBarcode) : "");
  if (!traceCode || !window.KERUIKANG_CLOUD_INVENTORY?.rpc) return null;
  try {
    const rows = await window.KERUIKANG_CLOUD_INVENTORY.rpc("rpc_trace_code_status", {
      p_raw_code: traceCode
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (/function .* does not exist/i.test(error.message || "")) return null;
    console.warn(error);
    return { success: false, message: error.message };
  }
}

function findLocalMedicine(parsed, rawBarcode) {
  const keys = traceLookupKeys(parsed, rawBarcode);
  return data.medicines.find(medicine => keys.includes(medicine.barcode) || keys.includes(medicine.code));
}

async function externalLookup(barcode, parsed) {
  const approvalNo = window.clinicNormalizeApprovalNo?.(parsed?.approvalNo || parsed?.code || "");
  const proxyItem = await window.clinicExternalDrugLookup?.({
    rawCode: parsed?.traceFullCode || barcode,
    barcode,
    traceCode: parsed?.traceFullCode || parsed?.traceDrugCode || "",
    approvalNo
  });
  if (proxyItem?.__lookupError) return proxyItem;
  if (proxyItem?.name) return proxyItem;

  const endpoint = localStorage.getItem("clinic-barcode-api-url");
  if (!endpoint) return null;

  const lookupValue = parsed?.traceFullCode || barcode;
  try {
    const response = await fetch(endpoint.replace("{barcode}", encodeURIComponent(lookupValue)));
    if (!response.ok) return null;
    const body = await response.json();
    const item = body.data || body.product || body;
    if (!item?.name && !item?.medicineName && !item?.drugName) return null;
    return {
      name: item.name || item.medicineName || item.drugName,
      code: item.code || item.approvalNo || item.approval_number || "",
      category: item.category || "\u897f\u836f",
      spec: item.spec || item.specification || "",
      unit: item.unit || "",
      manufacturer: item.manufacturer || "",
      salePrice: item.salePrice || item.price || "",
      batchNo: item.batchNo || "",
      productionDate: item.productionDate || compactDate(item.production_date),
      expiryDate: item.expiryDate || compactDate(item.expiry_date),
      quantity: item.quantity || "",
      traceCode: item.traceCode || "",
      serialNo: item.serialNo || "",
      productResourceCode: item.productResourceCode || "",
      externalSource: item.externalSource || "",
      externalDrugId: item.externalDrugId || "",
      codeStatus: item.codeStatus || "",
      packageLevel: item.packageLevel || ""
    };
  } catch {
    return null;
  }
}

function fillMedicineForm(item, parsed, source) {
  const medicine = { ...item };
  const barcodeToStore = parsed.traceFullCode || parsed.traceDrugCode || parsed.gtin || parsed.barcode || medicineBarcodeInput.value;
  const isTrace = isFullTraceCode(parsed, barcodeToStore) || parsed.traceDrugCode;
  setField(medicineEntryForm, "barcode", barcodeToStore);
  setField(medicineEntryForm, "name", medicine.name);
  setField(medicineEntryForm, "code", medicine.code || medicine.approvalNo || (isTrace ? "" : `BC-${barcodeToStore || Date.now()}`));
  setField(medicineEntryForm, "category", medicine.category || "\u897f\u836f");
  setField(medicineEntryForm, "spec", medicine.spec);
  setField(medicineEntryForm, "unit", medicine.unit);
  setField(medicineEntryForm, "manufacturer", medicine.manufacturer);
  setField(medicineEntryForm, "minStock", medicine.minStock);
  setField(medicineEntryForm, "salePrice", medicine.salePrice);
  setField(medicineEntryForm, "batchNo", parsed.batchNo || medicine.batchNo);
  setField(medicineEntryForm, "productionDate", parsed.productionDate || medicine.productionDate);
  setField(medicineEntryForm, "expiryDate", parsed.expiryDate || medicine.expiryDate);
  setField(medicineEntryForm, "quantity", parsed.quantity || medicine.quantity);

  const status = setScanState(medicineEntryForm, lookupResult, scanStatus(medicineEntryForm, "medicine", medicine, parsed));
  lookupResult.innerHTML = resultHtml(
    status.state === "success" ? "lookup-success" : "lookup-warning",
    `${status.title}`,
    [
      status.detail,
      `${medicine.name || "\u5f85\u8865\u836f\u54c1\u540d\u79f0"} · ${medicine.spec || "\u5f85\u8865\u89c4\u683c"} · ${medicine.manufacturer || "\u5f85\u8865\u5382\u5bb6"}`,
      `\u8bc6\u522b\u7801 ${parsed.traceDrugCode || parsed.gtin || parsed.barcode || "-"}${parsed.traceSerialNo ? ` · \u5e8f\u5217\u53f7 ${parsed.traceSerialNo}` : ""}${parsed.batchNo ? ` · \u6279\u53f7 ${parsed.batchNo}` : ""}${parsed.expiryDate ? ` · \u6709\u6548\u671f ${parsed.expiryDate}` : ""}`,
      `\u6765\u6e90\uff1a${source}\u3002\u4fdd\u5b58\u524d\u8bf7\u6838\u5bf9\u5305\u88c5\u3001\u6279\u53f7\u548c\u6709\u6548\u671f\u3002`
    ]
  );
}

function fillStockForm(item, parsed, source) {
  const barcode = parsed.traceFullCode || parsed.traceDrugCode || parsed.gtin || parsed.barcode || stockBarcodeInput.value.trim();
  const medicine = findLocalMedicine(parsed, stockBarcodeInput.value.trim()) || data.medicines.find(m => m.name === item?.name);
  if (medicine) setField(stockEntryForm, "medicineId", medicine.id);
  setField(stockEntryForm, "batchNo", parsed.batchNo || item?.batchNo);
  setField(stockEntryForm, "productionDate", parsed.productionDate || item?.productionDate);
  setField(stockEntryForm, "expiryDate", parsed.expiryDate || item?.expiryDate);
  setField(stockEntryForm, "quantity", parsed.quantity || item?.quantity);

  const status = setScanState(stockEntryForm, stockLookupResult, scanStatus(stockEntryForm, "stock", medicine ? item : null, parsed));
  stockLookupResult.innerHTML = resultHtml(
    medicine && status.state === "success" ? "lookup-success" : "lookup-warning",
    medicine ? `${status.title}` : "\u5df2\u89e3\u6790\u8ffd\u6eaf\u7801\uff0c\u4f46\u672c\u836f\u54c1\u672a\u5efa\u6863",
    [
      status.detail,
      medicine ? `${medicine.name} · ${medicine.spec}` : "\u8bf7\u5148\u5728\u201c\u5f55\u5165\u65b0\u836f\u54c1\u201d\u4e2d\u4fdd\u5b58\u836f\u54c1\u6863\u6848\uff0c\u518d\u56de\u5230\u5165\u5e93\u767b\u8bb0\u3002",
      `\u8bc6\u522b\u7801 ${barcode || "-"}${parsed.traceSerialNo ? ` · \u5e8f\u5217\u53f7 ${parsed.traceSerialNo}` : ""}${parsed.batchNo ? ` · \u6279\u53f7 ${parsed.batchNo}` : ""}${parsed.expiryDate ? ` · \u6709\u6548\u671f ${parsed.expiryDate}` : ""}`,
      `\u6765\u6e90\uff1a${source}`
    ]
  );
}

async function lookupBarcode(target = "medicine") {
  const input = target === "stock" ? stockBarcodeInput : medicineBarcodeInput;
  const result = target === "stock" ? stockLookupResult : lookupResult;
  const form = target === "stock" ? stockEntryForm : medicineEntryForm;
  const raw = input.value.trim();
  if (!raw) return toast("\u8bf7\u5148\u626b\u63cf\u6216\u8f93\u5165\u6761\u7801");

  const parsed = parseBarcode(raw);
  const barcode = parsed.traceFullCode || parsed.traceDrugCode || parsed.gtin || parsed.barcode || raw;
  input.value = barcode;
  result.innerHTML = '<div class="lookup-loading">\u6b63\u5728\u89e3\u6790\u6761\u7801\u5e76\u67e5\u8be2\u836f\u54c1\u8d44\u6599...</div>';

  const cloudStatus = await checkCloudTrace(parsed, raw);
  if (cloudStatus?.duplicate) {
    setLookupState(form, parsed, {}, "云端追溯码查重", cloudStatus);
    setScanState(form, result, { state: "duplicate" });
    result.innerHTML = resultHtml("lookup-missing", "\u8be5\u76d2\u836f\u5df2\u7ecf\u5165\u5e93", [
      `\u5b8c\u6574\u8ffd\u6eaf\u7801\uff1a${cloudStatus.trace_code || traceCodeFor(parsed, raw)}`,
      cloudStatus.drug_name ? `\u5df2\u5165\u5e93\u836f\u54c1\uff1a${cloudStatus.drug_name}` : "\u7cfb\u7edf\u5df2\u627e\u5230\u8be5\u8ffd\u6eaf\u7801\u7684\u5165\u5e93\u8bb0\u5f55\u3002",
      "\u4e3a\u9632\u6b62\u91cd\u590d\u5165\u5e93\uff0c\u672c\u6b21\u4fdd\u5b58\u5df2\u88ab\u62e6\u622a\u3002"
    ]);
    window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
    return;
  }

  const local = findLocalMedicine(parsed, raw);
  const cloudLocal = cloudStatus?.medicine_id ? {
    id: cloudStatus.medicine_id,
    name: cloudStatus.drug_name,
    code: cloudStatus.approval_no,
    spec: cloudStatus.package_spec,
    manufacturer: cloudStatus.manufacturer
  } : null;
  const reference = null;
  const externalItem = await externalLookup(barcode, parsed);
  if (externalItem?.__lookupError && isFullTraceCode(parsed, raw)) {
    setLookupState(form, parsed, externalItem, "外部追溯接口", cloudStatus);
    setField(form, "barcode", parsed.traceFullCode);
    setScanState(form, result, { state: "manual" });
    const message = traceLookupErrorMessage(externalItem);
    result.innerHTML = resultHtml("lookup-warning", message.title, message.lines);
    window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
    return;
  }

  const item = local || cloudLocal || reference || (externalItem?.__lookupError ? null : externalItem) || demoBarcodeCatalog[barcode] || {};
  setLookupState(form, parsed, item, local ? "\u8bca\u6240\u5df2\u6709\u836f\u54c1\u5e93" : cloudLocal ? "\u4e91\u7aef\u672c\u5730\u836f\u54c1\u4e3b\u6863" : item.name ? "\u836f\u54c1\u8d44\u6599\u5e93" : "\u6761\u7801\u89e3\u6790", cloudStatus);

  if (target === "stock") {
    fillStockForm(item, parsed, local ? "\u8bca\u6240\u5df2\u6709\u836f\u54c1\u5e93" : cloudLocal ? "\u4e91\u7aef\u672c\u5730\u836f\u54c1\u4e3b\u6863" : item.name ? "\u836f\u54c1\u8d44\u6599\u5e93" : "\u6761\u7801\u89e3\u6790");
    window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
    return;
  }

  if (parsed.traceDrugCode && !item.name && !parsed.batchNo && !parsed.productionDate && !parsed.expiryDate) {
    setField(form, "barcode", parsed.traceFullCode || parsed.traceDrugCode);
    setScanState(form, result, { state: "manual" });
    result.innerHTML = resultHtml("lookup-warning", "已识别为完整药品追溯码", [
      `药品标识码：${parsed.traceDrugCode}${parsed.traceSerialNo ? `，序列号：${parsed.traceSerialNo}` : ""}`,
      "但外部追溯接口未返回药品资料。请检查外部接口配置，或使用包装照片识别兜底。",
      "系统不会把完整追溯码生成药品主档编码；该码只会作为单盒追溯码保存。"
    ]);
    window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
    return;
  }

  if (item.name || parsed.batchNo || parsed.expiryDate) {
    fillMedicineForm(item, parsed, local ? "\u8bca\u6240\u5df2\u6709\u836f\u54c1\u5e93" : cloudLocal ? "\u4e91\u7aef\u672c\u5730\u836f\u54c1\u4e3b\u6863" : item.name ? "\u836f\u54c1\u8d44\u6599\u5e93" : "\u6761\u7801\u89e3\u6790");
    window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
    return;
  }

  if (isFullTraceCode(parsed, raw)) {
    setField(form, "barcode", parsed.traceFullCode);
    setScanState(form, result, { state: "manual" });
    result.innerHTML = resultHtml("lookup-warning", "已识别为完整药品追溯码", [
      "外部追溯接口没有返回药品资料，不能自动建立药品主档编码。",
      "请使用包装照片识别兜底，或配置真实外部追溯接口后再自动匹配。",
      `完整追溯码：${parsed.traceFullCode}`
    ]);
    window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
    return;
  }

  setField(form, "code", `BC-${barcode}`);
  setScanState(form, result, { state: "manual" });
  result.innerHTML = resultHtml("lookup-warning", "\u65b0\u6761\u7801\u5f85\u5efa\u6863", [
    "\u672a\u5339\u914d\u5230\u836f\u54c1\u8d44\u6599\uff0c\u6761\u7801\u5df2\u4fdd\u7559\u5e76\u81ea\u52a8\u751f\u6210\u836f\u54c1\u7f16\u7801\u3002",
    "\u8bf7\u6309\u5305\u88c5\u624b\u52a8\u8865\u5168\u540d\u79f0\u3001\u89c4\u683c\u3001\u6279\u53f7\u3001\u751f\u4ea7\u65e5\u671f\u3001\u6709\u6548\u671f\u548c\u6570\u91cf\uff1b\u6838\u5bf9\u65e0\u8bef\u540e\u52fe\u9009\u786e\u8ba4\u5373\u53ef\u4fdd\u5b58\u3002"
  ]);
  window.dispatchEvent(new CustomEvent("clinic:barcode-lookup-complete"));
}

function validateScanBeforeSave(form, type) {
  const barcode = type === "stock" ? stockBarcodeInput.value.trim() : medicineBarcodeInput.value.trim();
  if (!barcode) return true;

  const confirmed = form.elements[type === "stock" ? "stockScanConfirmed" : "scanConfirmed"]?.checked;
  const status = form.dataset.scanState || "manual";
  if (status === "duplicate" || form.dataset.duplicateTrace === "true") {
    return toast("\u8be5\u76d2\u836f\u5df2\u5165\u5e93\uff0c\u4e0d\u80fd\u91cd\u590d\u4fdd\u5b58"), false;
  }
  const missing = type === "medicine"
    ? requiredMissing(form, ["name", "code", "spec", "unit", "batchNo", "productionDate", "expiryDate", "quantity"])
    : requiredMissing(form, ["medicineId", "batchNo", "productionDate", "expiryDate", "quantity"]);

  if (missing.length) return toast("\u626b\u7801\u8d44\u6599\u672a\u5b8c\u6574\uff0c\u8bf7\u8865\u5168\uff1a" + missing.map(labelFor).join("\u3001")), false;
  if (!confirmed) return toast("\u8bf7\u5148\u52fe\u9009\u5df2\u6838\u5bf9\u836f\u54c1\u5305\u88c5\u548c\u6279\u6b21\u4fe1\u606f"), false;
  if (status === "missing") return toast("\u626b\u7801\u672a\u8bc6\u522b\uff0c\u8bf7\u70b9\u51fb\u81ea\u52a8\u5bfc\u5165\uff1b\u5982\u679c\u4ecd\u672a\u5339\u914d\uff0c\u53ef\u624b\u52a8\u8865\u5168\u540e\u4fdd\u5b58\u3002"), false;
  if (new Date(form.elements.expiryDate.value) <= new Date(form.elements.productionDate.value)) {
    return toast("\u6709\u6548\u671f\u5fc5\u987b\u665a\u4e8e\u751f\u4ea7\u65e5\u671f"), false;
  }
  return true;
}

window.KERUIKANG_VALIDATE_SCAN_BEFORE_SAVE = validateScanBeforeSave;
document.getElementById("lookupBarcode").onclick = () => lookupBarcode("medicine");
document.getElementById("lookupStockBarcode").onclick = () => lookupBarcode("stock");

[medicineBarcodeInput, stockBarcodeInput].forEach(input => input?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    lookupBarcode(input.id === "stockBarcode" ? "stock" : "medicine");
  }
}));

medicineBarcodeInput.addEventListener("input", () => {
  lookupResult.innerHTML = "";
  medicineEntryForm.dataset.scanState = "";
  medicineEntryForm.dataset.lookupResult = "";
  medicineEntryForm.dataset.traceCode = "";
  medicineEntryForm.dataset.duplicateTrace = "";
  medicineEntryForm.elements.scanConfirmed.checked = false;
});

stockBarcodeInput.addEventListener("input", () => {
  stockLookupResult.innerHTML = "";
  stockEntryForm.dataset.scanState = "";
  stockEntryForm.dataset.lookupResult = "";
  stockEntryForm.dataset.traceCode = "";
  stockEntryForm.dataset.duplicateTrace = "";
  stockEntryForm.elements.stockScanConfirmed.checked = false;
});

window.handleScannedBarcode = (value, targetId) => {
  const input = document.getElementById(targetId) || medicineBarcodeInput;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  lookupBarcode(input.id === "stockBarcode" ? "stock" : "medicine");
};

const medicineSubmitWithScan = medicineEntryForm.onsubmit;
medicineEntryForm.onsubmit = function (event) {
  if (!validateScanBeforeSave(medicineEntryForm, "medicine")) {
    event.preventDefault();
    return;
  }
  medicineSubmitWithScan.call(this, event);
};

const stockSubmitWithScan = stockEntryForm.onsubmit;
stockEntryForm.onsubmit = function (event) {
  const type = new FormData(stockEntryForm).get("type");
  if (type === "in" && !validateScanBeforeSave(stockEntryForm, "stock")) {
    event.preventDefault();
    return;
  }
  stockSubmitWithScan.call(this, event);
};
