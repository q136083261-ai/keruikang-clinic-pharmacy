(function () {
  const form = document.getElementById("medicineForm");
  const lookupResult = document.getElementById("lookupResult");
  if (!form || !lookupResult) return;

  const panel = document.createElement("div");
  panel.className = "package-ocr-panel wide";
  panel.innerHTML = `
    <div class="package-ocr-actions">
      <button class="btn secondary" type="button" id="packageOcrButton">识别包装照片</button>
      <button class="btn secondary" type="button" id="packageTextButton">粘贴包装文字识别</button>
      <input id="packageOcrFile" type="file" accept="image/*" capture="environment" hidden>
    </div>
    <textarea id="packageOcrText" rows="4" placeholder="也可以把包装上的文字粘贴到这里，例如：药名、规格、厂家、批号、生产日期、有效期。" hidden></textarea>
    <div class="lookup-result" id="packageOcrResult"></div>
  `;
  lookupResult.insertAdjacentElement("afterend", panel);

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
      .replace(/[，]/g, ",")
      .replace(/[。]/g, ".")
      .replace(/[×Ｘ]/g, "x")
      .replace(/[／]/g, "/")
      .replace(/[－]/g, "-")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function parseDate(value) {
    if (!value) return "";
    const digits = String(value).replace(/\D/g, "");
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
    const blocked = /追溯码|标识码|序列号|批准文号|生产日期|有效期|规格|厂家|企业|批号|功能主治|用法用量/;
    const drugSuffix = /(片|胶囊|颗粒|丸|口服液|注射液|滴丸|糖浆|散|膏|贴|喷雾剂|合剂|酊|栓|洗剂|滴眼液|滴耳液)$/;
    return lines.find(line => line.length >= 2 && line.length <= 24 && drugSuffix.test(line) && !blocked.test(line)) || "";
  }

  function inferUnit(specText) {
    if (/支/.test(specText)) return "支";
    if (/瓶/.test(specText)) return "瓶";
    if (/袋/.test(specText)) return "袋";
    if (/包/.test(specText)) return "包";
    return "盒";
  }

  function parsePackageText(rawText) {
    const text = normalizeText(rawText);
    const compact = text.replace(/\n/g, " ");
    const approvalNo = firstMatch(compact, [
      /(国药准字[ZHBSJ]\d{8})/i,
      /批准文号[:\s]*(国药准字[ZHBSJ]\d{8})/i
    ]);
    const spec = firstMatch(compact, [
      /规格[:\s]*([^;；\n]+?)(?:\s{2,}| 生产| 批号| 有效期|$)/,
      /(\d+(?:\.\d+)?\s*(?:mg|g|ml|mL|ug|μg|IU|万单位)\s*(?:x|X|×)?\s*\d*\s*(?:片|粒|支|袋|瓶|丸|贴)?)/i
    ]);
    const manufacturer = firstMatch(compact, [
      /(?:生产企业|生产厂家|厂家|企业名称)[:\s]*([^;；\n]+?)(?:\s{2,}| 批号| 生产日期| 有效期|$)/,
      /(?:上市许可持有人)[:\s]*([^;；\n]+?)(?:\s{2,}| 批号| 生产日期| 有效期|$)/
    ]);
    const batchNo = firstMatch(compact, [
      /(?:产品批号|生产批号|批号|LOT|Lot)[:\s]*([A-Za-z0-9.-]{3,30})/
    ]);
    const productionDate = parseDate(firstMatch(compact, [
      /(?:生产日期|生产日期\/批号)[:\s]*(\d{4}[年./-]?\d{1,2}[月./-]?\d{1,2})/,
      /(?:MFG|MFD)[:\s]*(\d{4}[./-]?\d{1,2}[./-]?\d{1,2})/i
    ]));
    const expiryDate = parseDate(firstMatch(compact, [
      /(?:有效期至|有效期|失效期)[:\s]*(\d{4}[年./-]?\d{1,2}[月./-]?\d{1,2})/,
      /(?:EXP|Expiry)[:\s]*(\d{4}[./-]?\d{1,2}[./-]?\d{1,2})/i
    ]));
    const name = firstMatch(compact, [
      /(?:药品名称|通用名称|品名)[:\s]*([^;；\n]+?)(?:\s{2,}| 规格| 批准文号|$)/
    ]) || inferName(text);

    return {
      name,
      code: approvalNo,
      spec,
      unit: inferUnit(spec),
      manufacturer,
      batchNo,
      productionDate,
      expiryDate
    };
  }

  function fillFromParsed(parsed) {
    const map = {
      name: parsed.name,
      code: parsed.code,
      spec: parsed.spec,
      unit: parsed.unit,
      manufacturer: parsed.manufacturer,
      batchNo: parsed.batchNo,
      productionDate: parsed.productionDate,
      expiryDate: parsed.expiryDate
    };
    Object.entries(map).forEach(([name, value]) => {
      if (!value) return;
      const field = form.elements[name];
      if (!field) return;
      if (field.tagName === "SELECT" && ![...field.options].some(option => option.value === value || option.textContent === value)) {
        field.add(new Option(value, value));
      }
      field.value = value;
    });
    if (!form.elements.quantity.value) form.elements.quantity.value = "1";
  }

  function applyText(text) {
    const parsed = parsePackageText(text);
    fillFromParsed(parsed);
    const filled = Object.entries(parsed).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`);
    const missing = ["name", "code", "spec", "batchNo", "productionDate", "expiryDate"].filter(key => !parsed[key]);
    setStatus(
      filled.length ? "包装文字已识别，已自动填入表单" : "暂未识别到可用字段",
      [
        ...filled,
        missing.length ? `仍需人工核对/补全：${missing.join("、")}` : "关键字段已识别，保存前请按包装核对。"
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
    setStatus("正在识别包装照片...", ["图片越清晰、文字越正，识别越准。"]);
    try {
      const endpointText = await ocrWithEndpoint(file);
      if (endpointText) {
        textBox.hidden = false;
        textBox.value = endpointText;
        applyText(endpointText);
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
      applyText(text);
    } catch (error) {
      console.error(error);
      setStatus("浏览器 OCR 加载失败", [
        "可以先把包装文字手动粘贴到下方文本框识别。",
        "后续建议接入授权 OCR/药品追溯数据库接口，识别会更稳定。"
      ]);
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
})();
