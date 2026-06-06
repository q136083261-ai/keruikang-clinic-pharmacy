(function () {
  const form = document.getElementById("medicineForm");
  const barcodeRow = document.querySelector("#medicineBarcode")?.closest("label");
  if (!form || !barcodeRow) return;

  const label = {
    photo: "\u8bc6\u522b\u5305\u88c5\u7167\u7247",
    paste: "\u7c98\u8d34\u5305\u88c5\u6587\u5b57\u8bc6\u522b",
    textPlaceholder: "\u4e5f\u53ef\u4ee5\u628a\u5305\u88c5\u4e0a\u7684\u6587\u5b57\u7c98\u8d34\u5230\u8fd9\u91cc\uff0c\u4f8b\u5982\uff1a\u836f\u540d\u3001\u89c4\u683c\u3001\u5382\u5bb6\u3001\u6279\u53f7\u3001\u751f\u4ea7\u65e5\u671f\u3001\u6709\u6548\u671f\u3002",
    working: "\u6b63\u5728\u8bc6\u522b\u5305\u88c5\u7167\u7247...",
    filled: "\u5305\u88c5\u6587\u5b57\u5df2\u8bc6\u522b\uff0c\u5df2\u81ea\u52a8\u586b\u5165\u8868\u5355",
    empty: "\u6682\u672a\u8bc6\u522b\u5230\u53ef\u7528\u5b57\u6bb5",
    missing: "\u4ecd\u9700\u4eba\u5de5\u6838\u5bf9/\u8865\u5168",
    ok: "\u5173\u952e\u5b57\u6bb5\u5df2\u8bc6\u522b\uff0c\u4fdd\u5b58\u524d\u8bf7\u6309\u5305\u88c5\u6838\u5bf9\u3002",
    fail: "\u6d4f\u89c8\u5668 OCR \u52a0\u8f7d\u5931\u8d25",
    failHint: "\u53ef\u4ee5\u5148\u628a\u5305\u88c5\u6587\u5b57\u624b\u52a8\u7c98\u8d34\u5230\u6587\u672c\u6846\u8bc6\u522b\u3002"
  };

  const fieldLabel = {
    name: "\u836f\u54c1\u540d\u79f0",
    code: "\u836f\u54c1\u7f16\u7801/\u6279\u51c6\u6587\u53f7",
    spec: "\u89c4\u683c",
    unit: "\u5355\u4f4d",
    manufacturer: "\u751f\u4ea7\u5382\u5bb6",
    batchNo: "\u6279\u53f7",
    productionDate: "\u751f\u4ea7\u65e5\u671f",
    expiryDate: "\u6709\u6548\u671f"
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
    const suffix = /(片|胶囊|颗粒|丸|口服液|注射液|滴丸|糖浆|散|膏|贴|喷雾剂|合剂|酊|栓|洗剂|滴眼液|滴耳液)$/;
    return lines.find(line => line.length >= 2 && line.length <= 24 && suffix.test(line) && !blocked.test(line)) || "";
  }

  function inferUnit(specText) {
    if (/支/.test(specText)) return "\u652f";
    if (/瓶/.test(specText)) return "\u74f6";
    if (/袋/.test(specText)) return "\u888b";
    if (/包/.test(specText)) return "\u5305";
    return "\u76d2";
  }

  function parsePackageText(rawText) {
    const text = normalizeText(rawText);
    const compact = text.replace(/\n/g, " ");
    const code = firstMatch(compact, [
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
      /(?:生产日期)[:\s]*(\d{4}[年./-]?\d{1,2}[月./-]?\d{1,2})/,
      /(?:MFG|MFD)[:\s]*(\d{4}[./-]?\d{1,2}[./-]?\d{1,2})/i
    ]));
    const expiryDate = parseDate(firstMatch(compact, [
      /(?:有效期至|有效期|失效期)[:\s]*(\d{4}[年./-]?\d{1,2}[月./-]?\d{1,2})/,
      /(?:EXP|Expiry)[:\s]*(\d{4}[./-]?\d{1,2}[./-]?\d{1,2})/i
    ]));
    const name = firstMatch(compact, [
      /(?:药品名称|通用名称|品名)[:\s]*([^;；\n]+?)(?:\s{2,}| 规格| 批准文号|$)/
    ]) || inferName(text);

    return { name, code, spec, unit: inferUnit(spec), manufacturer, batchNo, productionDate, expiryDate };
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

  function applyText(text) {
    const parsed = parsePackageText(text);
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
        missing.length ? `${label.missing}: ${missing.join("\u3001")}` : label.ok
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
    setStatus(label.working, ["\u56fe\u7247\u8d8a\u6e05\u6670\u3001\u6587\u5b57\u8d8a\u6b63\uff0c\u8bc6\u522b\u8d8a\u51c6\u3002"]);
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
      setStatus(label.fail, [label.failHint, "\u540e\u7eed\u5efa\u8bae\u63a5\u5165\u6388\u6743 OCR/\u836f\u54c1\u8ffd\u6eaf\u6570\u636e\u5e93\u63a5\u53e3\u3002"]);
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
