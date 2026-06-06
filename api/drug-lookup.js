const crypto = require("crypto");

const MSFX_20_RE = /^8\d{19}$/;
const MOCK_TRACE_CODE = "83711700173703755001";

function pick(value, fallback = "") {
  return value === undefined || value === null ? fallback : value;
}

function parseDrugCode(rawCode = "") {
  const raw = String(rawCode || "").trim();
  const digits = raw.replace(/\D/g, "");

  if (MSFX_20_RE.test(digits)) {
    return {
      codeType: "MSFX_20",
      rawCode: raw,
      traceCode: digits,
      productResourceCode: digits.slice(0, 7),
      serialNo: digits.slice(7)
    };
  }

  if (/^\d{13}$/.test(digits)) {
    return {
      codeType: "EAN13",
      rawCode: raw,
      barcode: digits,
      traceCode: "",
      productResourceCode: "",
      serialNo: ""
    };
  }

  return {
    codeType: "UNKNOWN",
    rawCode: raw,
    barcode: digits || raw,
    traceCode: "",
    productResourceCode: "",
    serialNo: ""
  };
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{6}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  return text.replace(/[年./]/g, "-").replace(/月$/, "").replace(/月/g, "-").replace(/日$/, "");
}

function normalizeDrug(item, parsed = {}) {
  if (!item) return null;
  const name = pick(item.name || item.medicineName || item.drugName || item.title);
  if (!name) return null;
  const approvalNo = pick(item.approvalNo || item.approval_no || item.approval_number || item.approval || item.number || item.code);
  return {
    drugName: name,
    name,
    approvalNo,
    code: approvalNo,
    category: pick(item.category || item.type, "西药"),
    packageSpec: pick(item.packageSpec || item.spec || item.specification || item.guige),
    spec: pick(item.packageSpec || item.spec || item.specification || item.guige),
    unit: pick(item.unit),
    manufacturer: pick(item.manufacturer || item.factory || item.company || item.enterprise),
    salePrice: pick(item.salePrice || item.price),
    batchNo: pick(item.batchNo || item.batch_no),
    productionDate: normalizeDate(item.productionDate || item.production_date),
    expiryDate: normalizeDate(item.expiryDate || item.expiry_date),
    quantity: pick(item.quantity),
    traceCode: pick(item.traceCode || parsed.traceCode),
    productResourceCode: pick(item.productResourceCode || parsed.productResourceCode),
    serialNo: pick(item.serialNo || parsed.serialNo),
    externalSource: pick(item.externalSource)
  };
}

function normalizeTraceDrug(body, parsed) {
  const data = body?.result || body?.data || body;
  const first = Array.isArray(data) ? data[0] : data;
  if (!first) return null;
  const base = first.drug_ent_base_d_t_o || first.drugEntBaseDTO || first.drug || first;
  const ent = first.p_user_ent_d_t_o || first.producer || first.enterprise || {};
  const status = first.code_status_type_d_t_o || first.codeStatus || {};
  const produce = first.code_produce_info_d_t_o || first.produceInfo || {};
  const produceList = produce.produce_info_list || produce.produceInfoList || [];
  const batch = Array.isArray(produceList) ? produceList[0] : produceList;
  const name = pick(base.physic_name || base.name || first.drugName);
  if (!name) return null;
  return normalizeDrug({
    name,
    approvalNo: pick(base.approval_licence_no || base.approvalNo || base.approval_number),
    category: base.physic_type_desc || "",
    packageSpec: pick(base.pkg_spec_crit || base.packageSpec || base.prepn_spec || base.spec),
    unit: "",
    manufacturer: pick(ent.ent_name || ent.name || first.manufacturer),
    batchNo: pick(batch?.batch_no || batch?.batchNo || first.batchNo),
    productionDate: pick(batch?.produce_date_str || batch?.original_produce_date || batch?.productionDate),
    expiryDate: pick(batch?.expire_date || batch?.original_expire_date || batch?.expiryDate),
    traceCode: pick(first.code || parsed.traceCode),
    serialNo: pick(first.serial_no || first.serialNo || parsed.serialNo),
    productResourceCode: pick(base.drug_ent_base_info_id || first.productResourceCode || parsed.productResourceCode),
    externalDrugId: pick(base.drug_ent_base_info_id || base.id),
    codeStatus: pick(status.code_status || status.status),
    packageLevel: pick(first.package_level || first.packageLevel),
    externalSource: "alihealth_trace"
  }, parsed);
}

async function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function json(res, status, payload) {
  return res.status(status).json(payload);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || body?.error || response.statusText || "Provider request failed";
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function signTopParams(params, secret) {
  const sorted = Object.keys(params).sort().map(key => `${key}${params[key]}`).join("");
  return crypto.createHash("md5").update(`${secret}${sorted}${secret}`, "utf8").digest("hex").toUpperCase();
}

function traceCredentialsConfigured() {
  return !!(process.env.ALIHEALTH_TOP_APP_KEY && process.env.ALIHEALTH_TOP_APP_SECRET && process.env.ALIHEALTH_REF_ENT_ID);
}

function mockAllowed() {
  return process.env.DRUG_LOOKUP_PROVIDER === "mock"
    && process.env.ALLOW_MOCK_DRUG_LOOKUP === "true"
    && process.env.VERCEL_ENV !== "production";
}

function lookupMock(parsed) {
  if (!mockAllowed() || parsed.traceCode !== MOCK_TRACE_CODE) return null;
  return normalizeDrug({
    name: "炎热清颗粒",
    approvalNo: "国药准字Z20090429",
    manufacturer: "南京同仁堂",
    packageSpec: "3g × 10袋",
    category: "中成药",
    unit: "盒",
    batchNo: "260101",
    productionDate: "2026-01-13",
    expiryDate: "2027-12",
    productResourceCode: "8371170",
    serialNo: "0173703755001",
    traceCode: MOCK_TRACE_CODE,
    externalSource: "mock"
  }, parsed);
}

async function lookupByGenericEndpoint(params, parsed) {
  const endpoint = process.env.DRUG_LOOKUP_ENDPOINT;
  if (!endpoint) return null;
  const apiKey = process.env.DRUG_LOOKUP_API_KEY || "";
  const url = new URL(endpoint);
  ["rawCode", "barcode", "approvalNo", "name", "traceCode"].forEach(key => {
    if (params[key]) url.searchParams.set(key, params[key]);
  });
  const body = await fetchJson(url.toString(), apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {});
  const item = body?.data || body?.result || body?.product || body?.medicine || body;
  return normalizeDrug(Array.isArray(item) ? item[0] : item, parsed);
}

async function lookupByAlihealthTrace(params, parsed) {
  const traceCode = parsed.traceCode || params.traceCode || params.barcode || "";
  if (parsed.codeType !== "MSFX_20" || !MSFX_20_RE.test(String(traceCode))) return null;
  if (!traceCredentialsConfigured()) return { configMissing: true };

  const gateway = process.env.ALIHEALTH_GATEWAY || "https://eco.taobao.com/router/rest";
  const method = process.env.ALIHEALTH_QUERY_METHOD || "alibaba.alihealth.drugtrace.top.yljg.query.codedetail";
  const query = {
    method,
    app_key: process.env.ALIHEALTH_TOP_APP_KEY,
    sign_method: process.env.ALIHEALTH_SIGN_METHOD || "md5",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    format: "json",
    v: "2.0",
    ref_ent_id: process.env.ALIHEALTH_REF_ENT_ID,
    codes: traceCode
  };
  query.sign = signTopParams(query, process.env.ALIHEALTH_TOP_APP_SECRET);

  const url = new URL(gateway);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const body = await fetchJson(url.toString());
  if (!body || body.error_response) {
    const message = body?.error_response?.sub_msg || body?.error_response?.msg || "外部追溯接口返回错误";
    const error = new Error(message);
    error.providerBody = body;
    throw error;
  }
  return normalizeTraceDrug(body, parsed);
}

async function lookupByJisu(params, parsed) {
  const appkey = process.env.JISU_MEDICINE_APPKEY;
  if (!appkey) return null;
  const base = "https://api.jisuapi.com/medicine";
  const approvalNo = params.approvalNo || "";
  const barcode = params.barcode || "";
  const name = params.name || "";

  const detailAttempts = [];
  if (approvalNo) detailAttempts.push(`${base}/detail?appkey=${encodeURIComponent(appkey)}&approval_num=${encodeURIComponent(approvalNo)}`);
  if (barcode && parsed.codeType !== "MSFX_20") detailAttempts.push(`${base}/detail?appkey=${encodeURIComponent(appkey)}&barcode=${encodeURIComponent(barcode)}`);
  for (const url of detailAttempts) {
    const body = await fetchJson(url);
    const normalized = normalizeDrug(body?.result || body?.data, parsed);
    if (normalized) return normalized;
  }

  const attempts = [];
  if (approvalNo) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&approval_num=${encodeURIComponent(approvalNo)}`);
  if (barcode && parsed.codeType !== "MSFX_20") attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&barcode=${encodeURIComponent(barcode)}`);
  if (name) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&name=${encodeURIComponent(name)}`);

  for (const url of attempts) {
    const body = await fetchJson(url);
    const list = body?.result?.list || body?.result || body?.data?.list || body?.data;
    const item = Array.isArray(list) ? list[0] : list;
    if (item?.medicine_id) {
      const detail = await fetchJson(`${base}/detail?appkey=${encodeURIComponent(appkey)}&medicine_id=${encodeURIComponent(item.medicine_id)}`);
      const normalizedDetail = normalizeDrug(detail?.result || detail?.data, parsed);
      if (normalizedDetail) return normalizedDetail;
    }
    const normalized = normalizeDrug(item, parsed);
    if (normalized) return normalized;
  }
  return null;
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) {
    return json(res, 405, { success: false, errorCode: "METHOD_NOT_ALLOWED", message: "Method not allowed" });
  }

  const body = await readBody(req);
  const query = req.query || {};
  const params = { ...query, ...body };
  const rawCode = params.rawCode || params.traceCode || params.barcode || "";
  const parsed = parseDrugCode(rawCode);
  params.rawCode = rawCode;
  params.traceCode = params.traceCode || parsed.traceCode;
  params.barcode = params.barcode || parsed.barcode || (parsed.codeType === "EAN13" ? parsed.rawCode : "");

  try {
    const mock = lookupMock(parsed);
    if (mock) {
      return json(res, 200, { success: true, provider: "mock", ...parsed, data: mock });
    }

    const generic = await lookupByGenericEndpoint(params, parsed);
    if (generic) {
      return json(res, 200, { success: true, provider: "generic", ...parsed, data: generic });
    }

    const trace = await lookupByAlihealthTrace(params, parsed);
    if (trace?.configMissing) {
      return json(res, 200, {
        success: false,
        errorCode: "CONFIG_MISSING",
        message: "外部追溯接口未配置",
        ...parsed
      });
    }
    if (trace) {
      return json(res, 200, { success: true, provider: "alihealth_trace", ...parsed, data: trace });
    }

    const jisu = await lookupByJisu(params, parsed);
    if (jisu) {
      return json(res, 200, { success: true, provider: "jisu", ...parsed, data: jisu });
    }

    return json(res, 404, {
      success: false,
      errorCode: "NOT_FOUND",
      message: "外部药品资料未匹配",
      ...parsed
    });
  } catch (error) {
    return json(res, 500, {
      success: false,
      errorCode: "PROVIDER_ERROR",
      message: error.message || "外部药品资料查询失败",
      ...parsed
    });
  }
}

module.exports = handler;
module.exports.parseDrugCode = parseDrugCode;
