(function () {
  const MIN_PASSWORD_LENGTH = 8;

  function client() {
    return window.supabaseClient || window.CLINIC_SUPABASE_CLIENT;
  }

  function showModal(id) {
    if (typeof openModal === "function") openModal(id);
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = text;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  function validateNewPassword(newPassword, confirmPassword, oldPassword = "") {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return "新密码至少需要 8 位。";
    }
    if (oldPassword && newPassword === oldPassword) {
      return "新密码不能和当前密码相同。";
    }
    if (newPassword !== confirmPassword) {
      return "两次输入的新密码不一致。";
    }
    return "";
  }

  async function currentAuthUser() {
    const supabase = client();
    if (!supabase?.auth) throw new Error("登录组件未加载，请刷新页面。");
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) throw new Error("当前登录状态已失效，请重新登录。");
    return data.user;
  }

  document.getElementById("accountMenuButton")?.addEventListener("click", event => {
    event.preventDefault();
    const menu = document.getElementById("accountMenu");
    if (menu) menu.hidden = !menu.hidden;
  });

  document.addEventListener("click", event => {
    const menu = document.getElementById("accountMenu");
    if (!menu || menu.hidden) return;
    if (!event.target.closest("#accountDropdown")) menu.hidden = true;
  });

  document.getElementById("changePasswordBtn")?.addEventListener("click", () => {
    document.getElementById("accountMenu").hidden = true;
    document.getElementById("changePasswordForm")?.reset();
    showModal("changePasswordModal");
  });

  document.getElementById("forgotPasswordBtn")?.addEventListener("click", () => {
    document.getElementById("forgotPasswordForm")?.reset();
    showModal("forgotPasswordModal");
  });

  document.getElementById("changePasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById("changePasswordSubmit");
    const values = Object.fromEntries(new FormData(form));
    const oldPassword = String(values.oldPassword || "");
    const newPassword = String(values.newPassword || "");
    const confirmPassword = String(values.confirmPassword || "");

    if (!oldPassword) return toast("当前密码不能为空。");
    const validation = validateNewPassword(newPassword, confirmPassword, oldPassword);
    if (validation) return toast(validation);

    setBusy(submit, true, "正在修改...");
    try {
      const supabase = client();
      const user = await currentAuthUser();
      if (!user.email) throw new Error("当前账号缺少邮箱，无法验证当前密码。");

      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPassword
      });
      if (verifyError) return toast("当前密码不正确，请重新输入。");

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      toast("密码修改成功，请重新登录。");
      await window.forceSignOutAndShowLogin?.("password_changed");
    } catch (error) {
      toast("密码修改失败：" + (error.message || "请稍后重试。"));
    } finally {
      setBusy(submit, false);
    }
  });

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-reset-password]");
    if (!button) return;
    event.preventDefault();
    if (currentUser().role !== "admin") return toast("只有管理员可以重置员工密码。");
    const user = data.users.find(item => item.id === button.dataset.resetPassword);
    if (!user) return toast("未找到该用户。");
    if (user.id === currentUser().id) return toast("自己的密码请使用右上角“修改密码”。");

    const form = document.getElementById("adminResetPasswordForm");
    form.reset();
    form.elements.userId.value = user.id;
    form.elements.targetUserId.value = user.id;
    form.elements.displayName.value = user.name || user.id;
    form.elements.forceReauth.checked = true;
    showModal("adminResetPasswordModal");
  });

  document.getElementById("adminResetPasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById("adminResetPasswordSubmit");
    const values = Object.fromEntries(new FormData(form));
    const newPassword = String(values.newPassword || "");
    const confirmPassword = String(values.confirmPassword || "");
    const userId = String(values.userId || "");

    if (userId === currentUser().id) return toast("自己的密码请使用右上角“修改密码”。");
    const validation = validateNewPassword(newPassword, confirmPassword);
    if (validation) return toast(validation);

    setBusy(submit, true, "正在重置...");
    try {
      const supabase = client();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (sessionError || !token) throw new Error("当前登录状态已失效，请重新登录。");

      const response = await fetch("/api/admin-reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId,
          newPassword,
          forceReauth: values.forceReauth === "on"
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.message || "重置密码失败。");
      }
      closeModals();
      form.reset();
      toast("密码已重置，请通知该用户重新登录。");
    } catch (error) {
      toast("重置密码失败：" + (error.message || "请稍后重试。"));
    } finally {
      setBusy(submit, false);
    }
  });

  document.getElementById("forgotPasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById("forgotPasswordSubmit");
    const email = String(new FormData(form).get("email") || "").trim();
    if (!email) return toast("请输入邮箱。");

    setBusy(submit, true, "正在发送...");
    try {
      const supabase = client();
      const redirectTo = window.location.origin + window.location.pathname + "?resetPassword=1";
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      closeModals();
      form.reset();
      toast("密码重置邮件已发送，如果没有收到，请联系管理员重置密码。");
    } catch (error) {
      toast("发送重置邮件失败：" + (error.message || "请稍后重试。"));
    } finally {
      setBusy(submit, false);
    }
  });

  document.getElementById("setNewPasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.getElementById("setNewPasswordSubmit");
    const values = Object.fromEntries(new FormData(form));
    const validation = validateNewPassword(String(values.newPassword || ""), String(values.confirmPassword || ""));
    if (validation) return toast(validation);

    setBusy(submit, true, "正在保存...");
    try {
      const supabase = client();
      const { error } = await supabase.auth.updateUser({ password: String(values.newPassword || "") });
      if (error) throw error;
      toast("密码已重置，请重新登录。");
      await window.forceSignOutAndShowLogin?.("password_reset");
    } catch (error) {
      toast("密码重置失败：" + (error.message || "请稍后重试。"));
    } finally {
      setBusy(submit, false);
    }
  });

  if (new URLSearchParams(window.location.search).get("resetPassword") === "1") {
    setTimeout(() => showModal("setNewPasswordModal"), 0);
  }
})();
