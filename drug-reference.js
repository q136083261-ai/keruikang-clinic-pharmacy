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
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    if (![...query.keys()].length) return null;
    try {
      const response = await fetch(`/api/drug-lookup?${query.toString()}`, {
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) return null;
      const body = await response.json();
      return body.data || null;
    } catch (error) {
      console.warn("External drug lookup failed", error);
      return null;
    }
  }

  window.clinicDrugReferenceLookup = () => null;
  window.clinicExternalDrugLookup = lookupExternalDrug;
  window.clinicNormalizeApprovalNo = normalizeApprovalNo;
})();
