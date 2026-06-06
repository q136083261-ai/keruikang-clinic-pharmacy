const crypto = require("crypto");

function pick(value, fallback = "") {
  return value === undefined || value === null ? fallback : value;
}

function normalizeDrug(item) {
  if (!item) return null;
  const name = pick(item.name || item.medicineName || item.drugName || item.title);
  if (!name) return null;
  return {
    name,
    code: pick(item.code || item.approvalNo || item.approval_number || item.approval || item.number),
    category: pick(item.category || item.type, "西药"),
    spec: pick(item.spec || item.specification || item.guige),
    unit: pick(item.unit),
    manufacturer: pick(item.manufacturer || item.factory || item.company || item.enterprise),
    salePrice: pick(item.salePrice || item.price),
    batchNo: pick(item.batchNo || item.batch_no),
    productionDate: pick(item.productionDate || item.production_date),
    expiryDate: pick(item.expiryDate || item.expiry_date),
    quantity: pick(item.quantity)
  };
}

function normalizeTraceDrug(body, rawCode = "") {
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
  return {
    name,
    code: pick(base.approval_licence_no || base.approvalNo || base.approval_number),
    category: base.physic_type_desc || "",
    spec: pick(base.pkg_spec_crit || base.packageSpec || base.prepn_spec || base.spec),
    unit: "",
    manufacturer: pick(ent.ent_name || ent.name || first.manufacturer),
    batchNo: pick(batch?.batch_no || batch?.batchNo || first.batchNo),
    productionDate: pick(batch?.produce_date_str || batch?.original_produce_date || batch?.productionDate),
    expiryDate: pick(batch?.expire_date || batch?.original_expire_date || batch?.expiryDate),
    traceCode: pick(first.code || rawCode),
    serialNo: pick(first.serial_no || first.serialNo),
    productResourceCode: pick(base.drug_ent_base_info_id || first.productResourceCode),
    externalDrugId: pick(base.drug_ent_base_info_id || base.id),
    codeStatus: pick(status.code_status || status.status),
    packageLevel: pick(first.package_level || first.packageLevel),
    externalSource: "alihealth_trace"
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "Accept": "application/json", ...headers } });
  if (!response.ok) return null;
  return response.json();
}

function signTopParams(params, secret) {
  const sorted = Object.keys(params).sort().map(key => `${key}${params[key]}`).join("");
  return crypto.createHash("md5").update(`${secret}${sorted}${secret}`, "utf8").digest("hex").toUpperCase();
}

async function lookupByAlihealthTrace(req) {
  const traceCode = req.query.traceCode || req.query.barcode || "";
  if (!traceCode || !/^8\d{19}$/.test(String(traceCode))) return null;

  const appKey = process.env.ALIHEALTH_TOP_APP_KEY;
  const appSecret = process.env.ALIHEALTH_TOP_APP_SECRET;
  const refEntId = process.env.ALIHEALTH_REF_ENT_ID;
  if (!appKey || !appSecret || !refEntId) return null;

  const gateway = process.env.ALIHEALTH_GATEWAY || "https://eco.taobao.com/router/rest";
  const method = process.env.ALIHEALTH_QUERY_METHOD || "alibaba.alihealth.drugtrace.top.yljg.query.codedetail";
  const params = {
    method,
    app_key: appKey,
    sign_method: process.env.ALIHEALTH_SIGN_METHOD || "md5",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    format: "json",
    v: "2.0",
    ref_ent_id: refEntId,
    codes: traceCode
  };
  params.sign = signTopParams(params, appSecret);

  const url = new URL(gateway);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const body = await fetchJson(url.toString());
  if (!body || body.error_response) return null;
  return normalizeTraceDrug(body, traceCode);
}

async function lookupByGenericEndpoint(req) {
  const endpoint = process.env.DRUG_LOOKUP_ENDPOINT;
  if (!endpoint) return null;
  const apiKey = process.env.DRUG_LOOKUP_API_KEY || "";
  const url = new URL(endpoint);
  ["barcode", "approvalNo", "name", "traceCode"].forEach(key => {
    if (req.query[key]) url.searchParams.set(key, req.query[key]);
  });
  const body = await fetchJson(url.toString(), apiKey ? { "Authorization": `Bearer ${apiKey}` } : {});
  const item = body?.data || body?.result || body?.product || body?.medicine || body;
  return normalizeDrug(Array.isArray(item) ? item[0] : item);
}

async function lookupByJisu(req) {
  const appkey = process.env.JISU_MEDICINE_APPKEY;
  if (!appkey) return null;
  const base = "https://api.jisuapi.com/medicine";
  const approvalNo = req.query.approvalNo || "";
  const barcode = req.query.barcode || req.query.traceCode || "";
  const name = req.query.name || "";

  const detailAttempts = [];
  if (approvalNo) detailAttempts.push(`${base}/detail?appkey=${encodeURIComponent(appkey)}&approval_num=${encodeURIComponent(approvalNo)}`);
  if (barcode) detailAttempts.push(`${base}/detail?appkey=${encodeURIComponent(appkey)}&barcode=${encodeURIComponent(barcode)}`);
  for (const url of detailAttempts) {
    const body = await fetchJson(url);
    const normalized = normalizeDrug(body?.result || body?.data);
    if (normalized) return normalized;
  }

  const attempts = [];
  if (approvalNo) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&approval_num=${encodeURIComponent(approvalNo)}`);
  if (barcode) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&barcode=${encodeURIComponent(barcode)}`);
  if (name) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&name=${encodeURIComponent(name)}`);

  for (const url of attempts) {
    const body = await fetchJson(url);
    const list = body?.result?.list || body?.result || body?.data?.list || body?.data;
    const item = Array.isArray(list) ? list[0] : list;
    if (item?.medicine_id) {
      const detail = await fetchJson(`${base}/detail?appkey=${encodeURIComponent(appkey)}&medicine_id=${encodeURIComponent(item.medicine_id)}`);
      const normalizedDetail = normalizeDrug(detail?.result || detail?.data);
      if (normalizedDetail) return normalizedDetail;
    }
    const normalized = normalizeDrug(item);
    if (normalized) return normalized;
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const item = await lookupByGenericEndpoint(req) || await lookupByAlihealthTrace(req) || await lookupByJisu(req);
    if (!item) return res.status(404).json({ data: null, error: "No drug data matched" });
    return res.status(200).json({ data: item });
  } catch (error) {
    return res.status(500).json({ data: null, error: error.message || "Lookup failed" });
  }
};
