(function () {
  const FORCE_LOGIN_KEY = "keruikang-force-login";

  function hasForceLoginQuery() {
    return new URLSearchParams(window.location.search).get("forceLogin") === "1";
  }

  function shouldClearKey(key) {
    const lower = String(key || "").toLowerCase();
    return (
      key.startsWith("sb-") ||
      lower.includes("supabase") ||
      lower.includes("keruikang") ||
      lower.includes("clinic") ||
      lower.includes("currentuser") ||
      lower.includes("currentrole") ||
      lower.includes("admin")
    );
  }

  function clearStorage(storage) {
    for (const key of Object.keys(storage)) {
      if (shouldClearKey(key)) storage.removeItem(key);
    }
  }

  function clearAuthCaches() {
    clearStorage(window.localStorage);
    clearStorage(window.sessionStorage);
    window.currentUser = null;
    window.currentRole = null;
    window.currentClinicUser = null;
    window.currentPermissions = null;
    if (window.data) {
      window.data.currentUserId = "";
    }
  }

  function markForceLogin() {
    try {
      window.sessionStorage.setItem(FORCE_LOGIN_KEY, "1");
    } catch (error) {
      console.warn("Unable to mark force login state", error);
    }
  }

  function releaseForceLogin() {
    try {
      window.sessionStorage.removeItem(FORCE_LOGIN_KEY);
    } catch (error) {
      console.warn("Unable to release force login state", error);
    }
    if (hasForceLoginQuery()) {
      const next = new URL(window.location.href);
      next.search = "";
      next.hash = "";
      window.history.replaceState(null, "", next.toString());
    }
  }

  function shouldForceLogin() {
    return hasForceLoginQuery() || window.sessionStorage.getItem(FORCE_LOGIN_KEY) === "1";
  }

  async function forceSignOutAndShowLogin(reason = "switch_account") {
    try {
      const auth = window.supabaseClient?.auth || window.CLINIC_SUPABASE_CLIENT?.auth;
      if (auth?.signOut) await auth.signOut({ scope: "local" });
    } catch (error) {
      console.warn("Supabase signOut failed, fallback to local cleanup", error);
    }

    clearAuthCaches();
    markForceLogin();

    if (window.location.hash && window.location.hash.includes("access_token")) {
      const clean = new URL(window.location.href);
      clean.hash = "";
      window.history.replaceState(null, "", clean.toString());
    }

    const next = new URL(window.location.href);
    next.searchParams.set("forceLogin", "1");
    next.searchParams.set("reason", reason);
    next.searchParams.set("t", String(Date.now()));
    next.hash = "";
    window.location.href = next.toString();
  }

  window.KERUIKANG_AUTH_SESSION = {
    shouldForceLogin,
    clearAuthCaches,
    releaseForceLogin,
    forceSignOutAndShowLogin
  };
  window.forceSignOutAndShowLogin = forceSignOutAndShowLogin;

  if (shouldForceLogin()) {
    clearAuthCaches();
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("#switchAccountBtn");
    if (!button) return;
    event.preventDefault();
    forceSignOutAndShowLogin("switch_account");
  });
})();
