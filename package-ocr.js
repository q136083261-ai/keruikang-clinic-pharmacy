(function () {
  const form = document.getElementById("medicineForm");
  const barcodeRow = document.querySelector("#medicineBarcode")?.closest("label");
  if (!form || !barcodeRow) return;

  const label = {
    photo: "识别包装照片",
    paste: "粘贴包装文字识别",
    textPlaceholder: "也可以把包装上的文字粘贴到这里，例如：药名、规格、厂家、批号、生产日期、有效期。",
    working: "正在识别包装照片...",
    external: "正在查询外部药品资料库...",
    filled: "包装文字已识别，已自动填入表单",
    empty: "暂未识别到可用字段",
    missing: "仍需人工核对/补全",
    ok: "关键字段已识别，保存前请按包装核对。",
    fail: "浏览器 OCR 加载失败",
    failHint: "可以先把包装文字手动粘贴到文本框识别。"
  };

  const fieldLabel = {
    name: "药品名称",
    code: "药品编码/批准文号",
    spec: "规格",
    unit: "单位",
    manufacturer: "生产厂家",
    batchNo: "批号",
    productionDate: "生产日期",
    expiryDate: "有效期"
  };

  if (!document.getElementById("packageOcrButton")) {
    const panel = document.createElement("div");
    panel.className = "package-ocr-panel wide";
    panel.innerHTML = `
      <div class="package-ocr-actions">
        <button class="btn secondary" type="button" id="packageOcrButton">${label.photo}</button>
        <button class="btn secondary" type="button" id="packageTextButton">${label.paste}</button>
        <input id="packageOcrFile" type="file" accept="image/*" capture="environment" hidden>
      </div>
      <textarea id="packageOcrText" rows="4" placeholder="${label.textPlaceholder}" hidden></textarea>
      <div class="lookup-result" id="packageOcrResult"></div>
    `;
    barcodeRow.insertAdjacentElement("afterend", panel);
  }

  const fileInput = document.getElementById("packageOcrFile");
  const textBox = document.getElementById("packageOcrText");
  const resultBox = document.getElementById("packageOcrResult");

  function setStatus(title, lines = [], kind = "lookup-warning") {
    resultBox.innerHTML = `<div class="${kind}"><strong>${title}</strong>${lines.map(line => `<span>${line}</span>`).join("")}</div>`;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[：﹕]/g, ":")
      .replace(/[，、]/g, ",")
      .replace(/[×✕＊*]/g, "x")
      .replace(/[【〔［]/g, "[")
      .replace(/[】〕］]/g, "]")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function normalizeOcrDigits(value) {
    return String(value || "")
      .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 65248))
      .replace(/[OoQq]/g, "0")
      .replace(/[CcGg]/g, "0")
      .replace(/[Il|]/g, "1")
      .replace(/[Ss]/g, "5")
      .replace(/[Zz]/g, "2")
      .replace(/\s+/g, "");
  }

  function parseDate(value, preferEndOfMonth = false) {
    if (!value) return "";
    const source = normalizeOcrDigits(String(value));
    const chinese = source.match(/(20\d{2})\D{0,4}(\d{1,2})\D{0,4}(\d{1,2})?/);
    if (chinese) {
      const day = (chinese[3] || (preferEndOfMonth ? "28" : "01")).padStart(2, "0");
      return `${chinese[1]}-${chinese[2].padStart(2, "0")}-${day}`;
    }
    const digits = source.replace(/\D/g, "");
    if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (digits.length === 6) return `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
    return "";
  }

  function firstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim().replace(/[;；,，。]+$/, "");
    }
    return "";
  }

  function inferName(text) {
    const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const blocked = /追溯码|标识码|序列号|批准文号|生产日期|有效期|规格|厂家|企业|批号|功能主治|用法用量|请仔细阅读|医师指导|国药准字/;
    const suffix = /(片|胶囊|颗粒|丸|口服液|注射液|滴丸|糖浆|散|膏|贴|喷雾剂|合剂|酊|栓|洗剂|滴眼液|滴耳液)$/;
    return lines.find(line => line.length >= 2 && line.length <= 28 && suffix.test(line) && !blocked.test(line)) || "";
  }

  function inferUnit(specText) {
    if (/支/.test(specText)) return "支";
    if (/瓶/.test(specText)) return "瓶";
    if (/袋/.test(specText)) return "袋";
    if (/包/.test(specText)) return "包";
    if (/盒/.test(specText)) return "盒";
    return "盒";
  }

  function extractDateCandidates(text) {
    const normalized = normalizeOcrDigits(text);
    return [...normalized.matchAll(/(20\d{2})\D{0,8}(\d{1,2})\D{0,8}(\d{1,2})?/g)]
      .map(match => {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = match[3] ? Number(match[3]) : null;
        if (year < 2000 || year > 2099 || month < 1 || month > 12 || (day !== null && (day < 1 || day > 31))) return null;
        return {
          value: `${year}-${String(month).padStart(2, "0")}-${String(day || 28).padStart(2, "0")}`,
          dayKnown: day !== null
        };
      })
      .filter(Boolean);
  }

  function parseLabeledBatchAndDates(text) {
    const compact = text.split(/\n+/).map(line => line.trim()).filter(Boolean).join(" ");
    const batchRaw = firstMatch(compact, [
      /(?:产品批号|生产批号|批号|LOT|Lot)\D*([A-Za-z0-9\s.-]{3,30})/
    ]);
    const batchNo = normalizeOcrDigits(batchRaw).replace(/[^A-Z0-9.-]/gi, "").slice(0, 30);
    const productionRaw = firstMatch(compact, [
      /(?:生产日期|生产日|产日|生日)\D*(20\d{2}[^;；\n]{0,18})/,
      /(?:MFG|MFD)\D*(20\d{2}[^;；\n]{0,18})/i
    ]);
    const expiryRaw = firstMatch(compact, [
      /(?:有效期至|有效期|失效期|EXP|Expiry)\D*(20\d{2}[^;；\n]{0,18})/i
    ]);
    const candidates = extractDateCandidates(compact);
    const productionDate = parseDate(productionRaw) || (candidates.find(item => item.dayKnown)?.value || "");
    const expiryDate = parseDate(expiryRaw, true) || (candidates.find(item => productionDate && item.value > productionDate)?.value || candidates.at(-1)?.value || "");
    return { batchNo, productionDate, expiryDate };
  }

  function parsePackageText(rawText) {
    const text = normalizeText(rawText);
    const compact = text.replace(/\n/g, " ");
    const labeled = parseLabeledBatchAndDates(text);
    const rawApproval = firstMatch(compact, [
      /(国药准字[ZHBSJ]\d{8})/i,
      /批准文号[:\s]*(国药准字[ZHBSJ]\d{8})/i,
      /国药准字\s*([ZHBSJ270]\s*\d\s*\d\s*\d\s*\d\s*\d\s*\d\s*\d\s*\d)/i
    ]);
    const code = window.clinicNormalizeApprovalNo?.(rawApproval || compact) || rawApproval;
    const spec = firstMatch(compact, [
      /规格[:\s]*([^;；\n]+?)(?:\s{2,}| 生产| 批号| 有效期|$)/,
      /(\d+(?:\.\d+)?\s*(?:mg|g|ml|mL|ug|μg|IU|万单位)?\s*(?:x|X|×)?\s*\d*\s*(?:片|粒|支|袋|瓶|丸|贴|盒|包)?)/i
    ]);
    const manufacturer = firstMatch(compact, [
      /(?:生产企业|生产厂家|厂家|企业名称)[:\s]*([^;；\n]+?)(?:\s{2,}| 批号| 生产日期| 有效期|$)/,
      /(?:上市许可持有人)[:\s]*([^;；\n]+?)(?:\s{2,}| 批号| 生产日期| 有效期|$)/
    ]);
    const batchNo = labeled.batchNo;
    const productionDate = labeled.productionDate;
    const expiryDate = labeled.expiryDate;
    const name = firstMatch(compact, [
      /(?:药品名称|通用名称|品名)[:\s]*([^;；\n]+?)(?:\s{2,}| 规格| 批准文号|$)/
    ]) || inferName(text);

    return { name, code, spec, unit: inferUnit(spec), manufacturer, batchNo, productionDate, expiryDate };
  }

  async function enrichFromExternal(parsed) {
    const external = await window.clinicExternalDrugLookup?.({
      approvalNo: parsed.code,
      name: parsed.name,
      barcode: form.elements.barcode?.value || ""
    });
    if (!external) return parsed;
    return {
      ...parsed,
      name: parsed.name || external.name,
      code: parsed.code || external.code,
      category: external.category || parsed.category,
      spec: parsed.spec || external.spec,
      unit: parsed.unit || external.unit || inferUnit(external.spec),
      manufacturer: parsed.manufacturer || external.manufacturer,
      salePrice: external.salePrice || parsed.salePrice
    };
  }

  function fillSelectOrInput(name, value) {
    if (!value) return;
    const field = form.elements[name];
    if (!field) return;
    if (field.tagName === "SELECT" && ![...field.options].some(option => option.value === value || option.textContent === value)) {
      field.add(new Option(value, value));
    }
    field.value = value;
  }

  function fillFromParsed(parsed) {
    Object.entries(parsed).forEach(([name, value]) => fillSelectOrInput(name, value));
    if (!form.elements.quantity.value) form.elements.quantity.value = "1";
  }

  async function applyText(text) {
    let parsed = parsePackageText(text);
    setStatus(label.external, ["如果已配置外部药品库，将自动补全药名、规格和厂家。"]);
    parsed = await enrichFromExternal(parsed);
    fillFromParsed(parsed);
    const filled = Object.entries(parsed)
      .filter(([, value]) => value)
      .map(([key, value]) => `${fieldLabel[key] || key}: ${value}`);
    const missing = ["name", "code", "spec", "batchNo", "productionDate", "expiryDate"]
      .filter(key => !parsed[key])
      .map(key => fieldLabel[key] || key);
    setStatus(
      filled.length ? label.filled : label.empty,
      [
        ...filled,
        missing.length ? `${label.missing}: ${missing.join("、")}` : label.ok
      ],
      filled.length ? "lookup-success" : "lookup-warning"
    );
  }

  async function loadTesseract() {
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window.Tesseract;
  }

  async function ocrWithEndpoint(file) {
    const endpoint = localStorage.getItem("clinic-ocr-api-url");
    if (!endpoint) return "";
    const payload = new FormData();
    payload.append("image", file);
    const response = await fetch(endpoint, { method: "POST", body: payload });
    if (!response.ok) throw new Error("OCR endpoint failed");
    const body = await response.json();
    return body.text || body.data?.text || "";
  }

  async function recognizeImage(file) {
    setStatus(label.working, ["图片越清晰、文字越正，识别越准。建议先拍药盒正面，再拍批号/效期侧面。"]);
    try {
      const endpointText = await ocrWithEndpoint(file);
      if (endpointText) {
        textBox.hidden = false;
        textBox.value = endpointText;
        await applyText(endpointText);
        return;
      }
    } catch (error) {
      console.warn(error);
    }

    try {
      const Tesseract = await loadTesseract();
      const result = await Tesseract.recognize(file, "chi_sim+eng");
      const text = result?.data?.text || "";
      textBox.hidden = false;
      textBox.value = text;
      await applyText(text);
    } catch (error) {
      console.error(error);
      setStatus(label.fail, [label.failHint, "追溯码自动反查药品资料需要授权追溯平台接口；普通外部药品库优先通过国药准字、药名或商品条码匹配。"]);
      textBox.hidden = false;
    }
  }

  document.getElementById("packageOcrButton").onclick = () => fileInput.click();
  document.getElementById("packageTextButton").onclick = () => {
    textBox.hidden = !textBox.hidden;
    if (!textBox.hidden) textBox.focus();
  };
  textBox.addEventListener("input", () => applyText(textBox.value));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) recognizeImage(file);
  });

  window.KERUIKANG_PARSE_PACKAGE_TEXT = parsePackageText;
})();
