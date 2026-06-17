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

async function updatePassword(userId, newPassword) {
  return supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({ password: newPassword })
  });
}

async function writeAudit({ operatorUserId, targetUserId, req, forceReauth }) {
  const ip = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "";
  const userAgent = req.headers["user-agent"] || "";
  const detail = JSON.stringify({
    target_user_id: targetUserId,
    operator_user_id: operatorUserId,
    force_reauth: !!forceReauth,
    ip: String(ip).split(",")[0].trim(),
    user_agent: String(userAgent).slice(0, 300)
  });

  const attempts = [
    {
      action: "admin_reset_password",
      detail,
      target_user_id: targetUserId,
      operator_user_id: operatorUserId,
      ip: String(ip).split(",")[0].trim(),
      user_agent: String(userAgent).slice(0, 300)
    },
    {
      action: "admin_reset_password",
      detail,
      created_by: operatorUserId
    },
    {
      action: "admin_reset_password",
      detail
    }
  ];

  for (const payload of attempts) {
    try {
      await supabaseFetch("/rest/v1/audit_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload)
      });
      return true;
    } catch {
      // Try the next likely audit table shape. Never log password material.
    }
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return json(res, 405, { success: false, message: "请求方法不允许。" });
  }

  const token = bearerToken(req);
  if (!token) {
    return json(res, 401, { success: false, message: "请先登录。" });
  }

  const { url, serviceKey } = envConfig();
  if (!url || !serviceKey) {
    return json(res, 500, { success: false, message: "服务端密码管理环境变量未配置。" });
  }

  const body = await readBody(req);
  const userId = String(body.userId || "").trim();
  const newPassword = String(body.newPassword || "");
  const forceReauth = body.forceReauth === true;

  if (!userId) return json(res, 400, { success: false, message: "缺少目标用户。" });
  if (newPassword.length < 8) return json(res, 400, { success: false, message: "新密码至少需要 8 位。" });

  try {
    const operator = await currentUserFromToken(token);
    if (!operator?.id) return json(res, 401, { success: false, message: "登录状态无效。" });
    if (operator.id === userId) {
      return json(res, 400, { success: false, message: "自己的密码请使用“修改密码”。" });
    }

    const profile = await profileFor(operator.id);
    if (!hasUserManagementPermission(profile)) {
      return json(res, 403, { success: false, message: "当前账号没有重置密码权限。" });
    }

    await updatePassword(userId, newPassword);
    const auditWritten = await writeAudit({
      operatorUserId: operator.id,
      targetUserId: userId,
      req,
      forceReauth
    });

    return json(res, 200, { success: true, auditWritten, forceReauth });
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return json(res, status, {
      success: false,
      message: "重置密码失败：" + (error.message || "请稍后重试。")
    });
  }
};
