function json(res, status, payload) {
  return res.status(status).json(payload);
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

function envConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  };
}

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function supabaseFetch(path, options = {}) {
  const { url, serviceKey } = envConfig();
  const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${options.token || serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function currentUserFromToken(token) {
  return supabaseFetch("/auth/v1/user", { method: "GET", token });
}

async function profileFor(userId) {
  const rows = await supabaseFetch(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,active,permissions`,
    { method: "GET" }
  );
  return Array.isArray(rows) ? rows[0] : null;
}

function hasUserManagementPermission(profile) {
  if (!profile || profile.active === false) return false;
  if (profile.role === "admin") return true;
  return Array.isArray(profile.permissions) && profile.permissions.includes("users.manage");
}

function defaultPermissionsForRole(role, permissions) {
  if (Array.isArray(permissions) && permissions.length) return permissions;
  if (role === "admin") return [];
  if (role === "nurse" || role === "stock_operator") {
    return [
      "medicines.read",
      "medicine.create",
      "medicines.create",
      "inventory.read",
      "stock.in",
      "stock.out",
      "batch.read",
      "batch.create"
    ];
  }
  return [
    "medicine.create",
    "medicine.edit",
    "stock.in",
    "stock.out",
    "alerts.view",
    "transactions.view"
  ];
}

async function writeAudit({ operatorUserId, targetUserId, req, role }) {
  const ip = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "";
  const userAgent = req.headers["user-agent"] || "";
  const payload = {
    action: "admin_create_user",
    detail: JSON.stringify({
      target_user_id: targetUserId,
      operator_user_id: operatorUserId,
      role,
      ip: String(ip).split(",")[0].trim(),
      user_agent: String(userAgent).slice(0, 300)
    })
  };
  try {
    await supabaseFetch("/rest/v1/audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(payload)
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return json(res, 405, { success: false, message: "请求方法不允许。" });
  }

  const token = bearerToken(req);
  if (!token) return json(res, 401, { success: false, message: "请先登录。" });

  const { url, serviceKey } = envConfig();
  if (!url || !serviceKey) {
    return json(res, 500, { success: false, message: "服务端用户管理环境变量未配置。" });
  }

  const body = await readBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim();
  const role = String(body.role || "nurse").trim();
  const active = body.active !== false;
  const permissions = defaultPermissionsForRole(role, body.permissions);

  if (!email) return json(res, 400, { success: false, message: "请填写登录邮箱。" });
  if (password.length < 8) return json(res, 400, { success: false, message: "初始密码至少需要 8 位。" });
  if (!displayName) return json(res, 400, { success: false, message: "请填写用户姓名。" });
  if (!["admin", "manager", "user", "nurse", "stock_operator"].includes(role)) {
    return json(res, 400, { success: false, message: "账号角色不正确。" });
  }

  try {
    const operator = await currentUserFromToken(token);
    if (!operator?.id) return json(res, 401, { success: false, message: "登录状态无效。" });
    const profile = await profileFor(operator.id);
    if (!hasUserManagementPermission(profile)) {
      return json(res, 403, { success: false, message: "当前账号没有新增用户权限。" });
    }

    const authUser = await supabaseFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, role }
      })
    });
    const userId = authUser?.id || authUser?.user?.id;
    if (!userId) throw new Error("Supabase 未返回用户 ID。");

    await supabaseFetch("/rest/v1/profiles?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: userId,
        display_name: displayName,
        role,
        active,
        permissions
      })
    });

    const auditWritten = await writeAudit({ operatorUserId: operator.id, targetUserId: userId, req, role });
    return json(res, 200, {
      success: true,
      auditWritten,
      user: { id: userId, email, displayName, role, permissions, active }
    });
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return json(res, status, {
      success: false,
      message: "新增用户失败：" + (error.message || "请稍后重试。")
    });
  }
};
