const { createClient } = require("@supabase/supabase-js");

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

function decodeJwtPayload(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function serviceKeyStatus(serviceKey) {
  if (!serviceKey) return { ok: false, code: "CONFIG_MISSING", message: "SUPABASE_SERVICE_ROLE_KEY 未配置。" };
  if (serviceKey.startsWith("sb_publishable_")) {
    return { ok: false, code: "CONFIG_INVALID_SERVICE_ROLE_KEY", message: "SUPABASE_SERVICE_ROLE_KEY 当前像 publishable key，不是服务端 secret/service_role key。" };
  }
  if (serviceKey.startsWith("sb_anon_")) {
    return { ok: false, code: "CONFIG_INVALID_SERVICE_ROLE_KEY", message: "SUPABASE_SERVICE_ROLE_KEY 当前像 anon key，不是 service_role key。" };
  }
  if (serviceKey.startsWith("sb_secret_")) return { ok: true };

  const payload = decodeJwtPayload(serviceKey);
  if (payload && payload.role !== "service_role") {
    return { ok: false, code: "CONFIG_INVALID_SERVICE_ROLE_KEY", message: `SUPABASE_SERVICE_ROLE_KEY 当前 JWT role=${payload.role || "unknown"}，不是 service_role。` };
  }
  return { ok: true };
}

function makeAdminClient(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function currentUserFromToken(adminClient, token) {
  const { data, error } = await adminClient.auth.getUser(token);
  if (error) throw error;
  return data?.user || null;
}

async function profileFor(adminClient, userId) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id,role,active,permissions")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
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

function cleanPermissions(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || "").trim())
    .filter(Boolean))];
}

async function writeAudit(adminClient, { operatorUserId, targetUserId, req, role }) {
  const ip = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "";
  const userAgent = req.headers["user-agent"] || "";
  const { error } = await adminClient
    .from("audit_logs")
    .insert({
      action: "admin_create_user",
      detail: JSON.stringify({
        target_user_id: targetUserId,
        operator_user_id: operatorUserId,
        role,
        ip: String(ip).split(",")[0].trim(),
        user_agent: String(userAgent).slice(0, 300)
      })
    });
  if (error) throw error;
  return true;
}

async function rollbackCreatedUser(adminClient, userId) {
  if (!userId) return;
  try {
    await adminClient.from("profiles").delete().eq("id", userId);
  } catch (error) {
    console.error("admin-create-user rollback profile cleanup failed", {
      code: error.code,
      message: error.message
    });
  }
  try {
    await adminClient.auth.admin.deleteUser(userId);
  } catch (error) {
    console.error("admin-create-user rollback auth cleanup failed", {
      code: error.code,
      message: error.message
    });
  }
}

function safeErrorPayload(error) {
  return {
    code: error?.code || error?.status || error?.name || "UNKNOWN",
    message: error?.message || "未知错误"
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return json(res, 405, { success: false, stage: "method", code: "METHOD_NOT_ALLOWED", message: "请求方法不允许。" });
  }

  const token = bearerToken(req);
  if (!token) return json(res, 401, { success: false, stage: "auth", code: "NO_TOKEN", message: "请先登录。" });

  const { url, serviceKey } = envConfig();
  if (!url || !serviceKey) {
    return json(res, 500, { success: false, stage: "config", code: "CONFIG_MISSING", message: "服务端用户管理环境变量未配置。" });
  }
  const keyStatus = serviceKeyStatus(serviceKey);
  if (!keyStatus.ok) {
    return json(res, 500, { success: false, stage: "config", code: keyStatus.code, message: keyStatus.message });
  }

  const body = await readBody(req);
  const username = String(body.username || body.displayName || body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "nurse").trim();
  const active = body.active !== false;
  const permissions = cleanPermissions(defaultPermissionsForRole(role, body.permissions));

  if (!email) return json(res, 400, { success: false, stage: "validate", code: "EMAIL_REQUIRED", message: "请填写登录邮箱。" });
  if (password.length < 8) return json(res, 400, { success: false, stage: "validate", code: "PASSWORD_TOO_SHORT", message: "初始密码至少需要 8 位。" });
  if (!username) return json(res, 400, { success: false, stage: "validate", code: "USERNAME_REQUIRED", message: "请填写用户姓名。" });
  if (!["admin", "manager", "user", "nurse", "stock_operator"].includes(role)) {
    return json(res, 400, { success: false, stage: "validate", code: "INVALID_ROLE", message: "账号角色不正确。" });
  }

  const adminClient = makeAdminClient(url, serviceKey);
  let stage = "verify_operator";
  let createdUserId = "";

  try {
    const operator = await currentUserFromToken(adminClient, token);
    if (!operator?.id) return json(res, 401, { success: false, stage, code: "INVALID_SESSION", message: "登录状态无效。" });

    stage = "check_permission";
    const operatorProfile = await profileFor(adminClient, operator.id);
    if (!hasUserManagementPermission(operatorProfile)) {
      return json(res, 403, { success: false, stage, code: "FORBIDDEN", message: "当前账号没有新增用户权限。" });
    }

    stage = "create_auth_user";
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: username, role }
    });
    if (authError) throw authError;
    createdUserId = authData?.user?.id || "";
    if (!createdUserId) throw new Error("Supabase 未返回用户 ID。");

    stage = "save_profile";
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert({
        id: createdUserId,
        display_name: username,
        role,
        active,
        permissions
      }, { onConflict: "id" });
    if (profileError) throw profileError;

    stage = "save_role";
    const { error: roleError } = await adminClient
      .from("profiles")
      .update({ role, active })
      .eq("id", createdUserId);
    if (roleError) throw roleError;

    stage = "save_permissions";
    const { error: permissionsError } = await adminClient
      .from("profiles")
      .update({ permissions })
      .eq("id", createdUserId);
    if (permissionsError) throw permissionsError;

    stage = "write_audit";
    const auditWritten = await writeAudit(adminClient, {
      operatorUserId: operator.id,
      targetUserId: createdUserId,
      req,
      role
    });

    return json(res, 200, {
      success: true,
      auditWritten,
      user: { id: createdUserId, email, displayName: username, role, permissions, active }
    });
  } catch (error) {
    const safe = safeErrorPayload(error);
    console.error("admin-create-user failed", {
      stage,
      code: safe.code,
      message: safe.message,
      details: error?.details,
      hint: error?.hint
    });

    if (createdUserId && stage !== "create_auth_user") {
      await rollbackCreatedUser(adminClient, createdUserId);
    }

    const status = error?.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return json(res, status, {
      success: false,
      stage,
      code: safe.code,
      message: safe.message
    });
  }
};
