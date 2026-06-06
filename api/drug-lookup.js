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

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "Accept": "application/json", ...headers } });
  if (!response.ok) return null;
  return response.json();
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

  const attempts = [];
  if (approvalNo) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&approval_num=${encodeURIComponent(approvalNo)}`);
  if (barcode) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&barcode=${encodeURIComponent(barcode)}`);
  if (name) attempts.push(`${base}/query?appkey=${encodeURIComponent(appkey)}&name=${encodeURIComponent(name)}`);

  for (const url of attempts) {
    const body = await fetchJson(url);
    const list = body?.result?.list || body?.result || body?.data?.list || body?.data;
    const item = Array.isArray(list) ? list[0] : list;
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
    const item = await lookupByGenericEndpoint(req) || await lookupByJisu(req);
    if (!item) return res.status(404).json({ data: null, error: "No drug data matched" });
    return res.status(200).json({ data: item });
  } catch (error) {
    return res.status(500).json({ data: null, error: error.message || "Lookup failed" });
  }
};
