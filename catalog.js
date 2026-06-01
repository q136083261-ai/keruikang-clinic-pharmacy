const config = window.CLINIC_SUPABASE;
let catalogItems = [];
const esc = value => String(value ?? "").replace(/[&<>"']/g, x => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[x]));

function render() {
  const query = document.getElementById("catalogSearch").value.trim().toLowerCase();
  const category = document.getElementById("catalogCategory").value;
  const items = catalogItems.filter(item =>
    (!category || item.category === category) &&
    (!query || JSON.stringify([
      item.display_name, item.category, item.specification, item.manufacturer
    ]).toLowerCase().includes(query))
  );
  document.getElementById("catalogCount").textContent = `共 ${items.length} 种可售药品`;
  document.getElementById("catalogGrid").innerHTML = items.map(item => `
    <article class="catalog-card">
      <div class="catalog-card-top">
        <div>
          <h3>${esc(item.display_name)}</h3>
          <span class="category">${esc(item.category || "其他")} · ${esc(item.manufacturer || "")}</span>
        </div>
        <span class="risk ${item.stock_status === "有货" ? "risk-green" : "risk-orange"}">${esc(item.stock_status)}</span>
      </div>
      <p class="catalog-spec">${esc(item.specification || "")}</p>
      <div class="catalog-price">￥${Number(item.retail_price || 0).toFixed(2)} <small>/ ${esc(item.unit || "盒")}</small></div>
      <div class="catalog-meta">
        <span>有效期：${esc(item.expiry_notice || "请咨询工作人员")}</span>
        <span>提示：用药前请阅读说明书，并咨询医生或药师。</span>
      </div>
    </article>
  `).join("") || '<div class="catalog-empty">暂无符合条件的可售药品</div>';
}

async function loadCatalog() {
  try {
    const response = await fetch(`${config.url}/rest/v1/public_catalog?select=*&visible=eq.true&order=display_name`, {
      headers: { apikey: config.publishableKey }
    });
    if (!response.ok) throw new Error("目录读取失败");
    catalogItems = await response.json();
    const categories = [...new Set(catalogItems.map(x => x.category).filter(Boolean))];
    document.getElementById("catalogCategory").innerHTML =
      '<option value="">全部分类</option>' +
      categories.map(x => `<option>${esc(x)}</option>`).join("");
    document.getElementById("catalogUpdated").textContent =
      "更新时间：" + new Date().toLocaleString("zh-CN");
    render();
  } catch {
    document.getElementById("catalogGrid").innerHTML =
      '<div class="catalog-empty">暂时无法读取药品目录，请稍后刷新页面</div>';
  }
}

document.getElementById("catalogSearch").oninput = render;
document.getElementById("catalogCategory").onchange = render;
loadCatalog();
