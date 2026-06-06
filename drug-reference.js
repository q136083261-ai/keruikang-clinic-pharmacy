(function () {
  function normalizeKey(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 65248))
      .replace(/O/g, "0")
      .replace(/\s+/g, "")
      .replace(/[^\u4e00-\u9fa5A-Z0-9]/g, "");
  }

  function normalizeApprovalNo(value) {
    const compact = normalizeKey(value);
    const match = compact.match(/(?:国药准字)?([ZHBSJ270][0-9]{8})/i);
    if (!match) return "";
    let prefix = match[1][0].toUpperCase();
    if (prefix === "2" || prefix === "7" || prefix === "0") prefix = "Z";
    return `国药准字${prefix}${match[1].slice(1)}`;
  }

  async function lookupExternalDrug(params = {}) {
    const cleanParams = {};
    Object.entries(params).forEach(([key, value]) => {
      if (value) cleanParams[key] = value;
    });
    if (!Object.keys(cleanParams).length) return null;

    try {
      const hasTracePayload = cleanParams.rawCode || cleanParams.traceCode;
      const response = hasTracePayload
        ? await fetch("/api/drug-lookup", {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(cleanParams)
          })
        : await fetch(`/api/drug-lookup?${new URLSearchParams(cleanParams).toString()}`, {
            headers: { "Accept": "application/json" }
          });
      const body = await response.json().catch(() => ({}));
      if (body?.success === false) return { __lookupError: true, ...body };
      if (!response.ok) {
        return {
          __lookupError: true,
          errorCode: `HTTP_${response.status}`,
          message: body?.message || body?.error || "药品查询失败"
        };
      }
      return body.data || (body?.success ? body : null);
    } catch (error) {
      console.warn("External drug lookup failed", error);
      return {
        __lookupError: true,
        errorCode: "NETWORK_ERROR",
        message: error.message || "药品查询网络失败"
      };
    }
  }

  window.clinicDrugReferenceLookup = () => null;
  window.clinicExternalDrugLookup = lookupExternalDrug;
  window.clinicNormalizeApprovalNo = normalizeApprovalNo;
})();
