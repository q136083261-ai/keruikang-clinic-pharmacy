(function () {
  const config = window.CLINIC_SUPABASE;
  function status(text, kind = "idle") {
    let node = document.getElementById("cloudSyncStatus");
    if (!node) {
      node = document.createElement("div");
      node.id = "cloudSyncStatus";
      node.className = "cloud-sync-status";
      document.body.appendChild(node);
    }
    node.className = "cloud-sync-status " + kind;
    node.textContent = text;
  }

  if (!config || !window.supabase) {
    status("云端登录组件加载失败", "error");
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
      loginForm.onsubmit = function (event) {
        event.preventDefault();
        toast("登录组件未加载，请刷新页面；若仍失败，请检查网络或 CDN 访问。");
      };
    }
    return;
  }

  window.CLINIC_CLOUD_AUTH_READY = true;
  const client = window.supabase.createClient(config.url, config.publishableKey);
  window.supabaseClient = client;
  window.CLINIC_SUPABASE_CLIENT = client;
  const originalSave = save;
  let syncing = false;
  let syncTimer = 0;
  let remoteMedicineIds = new Set();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const nurseRolePermissions = ["medicines.read","medicine.create","medicines.create","inventory.read","stock.in","stock.out","batch.read","batch.create"];

  function cloudUser(profile, email) {
    const role = profile?.role || "viewer";
    return {
      id: profile?.id,
      name: profile?.display_name || email || "诊所用户",
      email: email || profile?.email || "",
      role,
      active: profile?.active !== false,
      permissions: role === "admin" ? permissionDefs.map(x => x[0]) :
        Array.isArray(profile?.permissions) && profile.permissions.length ? profile.permissions :
        (role === "nurse" || role === "stock_operator") ? [...nurseRolePermissions] :
        role === "operator" ? [...defaultPermissions] :
        ["alerts.view", "transactions.view"]
    };
  }

  function nearestExpiry(medicine) {
    const batch = (medicine.batches || [])
      .filter(x => x.quantity > 0 && new Date(x.expiryDate + "T23:59:59") >= new Date())
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];
    return batch ? `在售批次有效期至 ${batch.expiryDate}` : "请咨询工作人员";
  }

  async function profileFor(user) {
    const { data: profile, error } = await client
      .from("profiles")
      .select("id,display_name,role,active,permissions")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    return cloudUser(profile, user.email);
  }

  async function loadCloudState() {
    const { data: authData } = await client.auth.getUser();
    if (!authData?.user) return false;

    status("正在读取云端库存...", "working");
    const user = await profileFor(authData.user);
    if (!user.active) throw new Error("该账号已停用，请联系管理员");

    const [{ data: medicines, error: medicineError }, { data: batches, error: batchError }] =
      await Promise.all([
        client.from("medicines").select("*").order("created_at"),
        client.from("inventory_batches").select("*").order("created_at")
      ]);
    if (medicineError) throw medicineError;
    if (batchError) throw batchError;

    remoteMedicineIds = new Set((medicines || []).map(x => x.id));
    data.medicines = (medicines || []).map(m => ({
      id: m.id,
      name: m.name,
      code: m.approval_number || "",
      barcode: m.barcode || "",
      category: m.category || "其他",
      spec: m.specification || "",
      manufacturer: m.manufacturer || "",
      minStock: Number(m.low_stock_threshold || 0),
      unit: m.default_unit || "盒",
      dispenseUnit: m.default_unit || "盒",
      conversion: 1,
      location: "药房默认库位",
      salePrice: Number(m.retail_price || 0),
      warningDays: data.settings?.expiryWarningDays || 90,
      disabled: !m.active,
      publicVisible: false,
      batches: (batches || []).filter(b => b.medicine_id === m.id).map(b => ({
        id: b.id,
        batchNo: b.batch_number,
        productionDate: b.production_date || "",
        expiryDate: b.expiry_date,
        quantity: Number(b.quantity || 0),
        unit: b.unit || m.default_unit || "盒",
        location: b.location || ""
      }))
    }));

    const { data: catalog } = await client.from("public_catalog").select("medicine_id,visible");
    const catalogMap = new Map((catalog || []).map(x => [x.medicine_id, x.visible]));
    data.medicines.forEach(m => m.publicVisible = catalogMap.get(m.id) === true);
    if (user.role === "admin") {
      const { data: profiles, error: profilesError } = await client
        .from("profiles")
        .select("id,display_name,role,active,permissions")
        .order("display_name");
      if (profilesError) throw profilesError;
      data.users = (profiles || []).map(profile => cloudUser(profile, profile.id === user.id ? authData.user.email : ""));
    } else {
      data.users = [user];
    }
    data.currentUserId = user.id;
    localStorage.setItem(storeKey, JSON.stringify(data));
    render();
    document.getElementById("loginScreen").classList.add("hidden");
    status("云端库存已同步", "ok");
    return true;
  }

  async function syncCloudState() {
    if (syncing) return;
    const { data: authData } = await client.auth.getUser();
    if (!authData?.user) return;

    syncing = true;
    status("正在保存到云端...", "working");
    try {
      const cloudMedicines = data.medicines.filter(m => uuidPattern.test(m.id));
      for (const medicine of cloudMedicines) {
        const { error: medicineError } = await client.from("medicines").upsert({
          id: medicine.id,
          name: medicine.name,
          barcode: medicine.barcode || null,
          category: medicine.category || null,
          specification: medicine.spec || null,
          manufacturer: medicine.manufacturer || null,
          approval_number: medicine.code || null,
          default_unit: medicine.unit || "盒",
          retail_price: Number(medicine.salePrice || 0),
          low_stock_threshold: Number(medicine.minStock || 0),
          active: !medicine.disabled,
          created_by: authData.user.id
        });
        if (medicineError) throw medicineError;

        for (const batch of medicine.batches || []) {
          const { error: batchError } = await client.from("inventory_batches").upsert({
            medicine_id: medicine.id,
            batch_number: batch.batchNo,
            production_date: batch.productionDate || null,
            expiry_date: batch.expiryDate,
            quantity: Number(batch.quantity || 0),
            unit: medicine.unit || batch.unit || "盒",
            location: medicine.location || batch.location || null,
            created_by: authData.user.id
          }, { onConflict: "medicine_id,batch_number,expiry_date" });
          if (batchError) throw batchError;
        }

        const { error: catalogError } = await client.from("public_catalog").upsert({
          medicine_id: medicine.id,
          display_name: medicine.name,
          category: medicine.category || null,
          specification: medicine.spec || null,
          manufacturer: medicine.manufacturer || null,
          retail_price: Number(medicine.salePrice || 0),
          unit: medicine.unit || "盒",
          stock_status: total(medicine) <= 0 ? "暂时缺货" :
            total(medicine) <= Number(medicine.minStock || 0) ? "库存紧张" : "有货",
          expiry_notice: nearestExpiry(medicine),
          visible: medicine.publicVisible === true
        }, { onConflict: "medicine_id" });
        if (catalogError) throw catalogError;
      }

      const currentIds = new Set(cloudMedicines.map(x => x.id));
      for (const remoteId of remoteMedicineIds) {
        if (!currentIds.has(remoteId)) {
          const { error } = await client.from("medicines").delete().eq("id", remoteId);
          if (error) throw error;
        }
      }
      remoteMedicineIds = currentIds;
      status("已保存到云端", "ok");
    } catch (error) {
      console.error(error);
      status("云端保存失败，请检查网络", "error");
      toast("云端保存失败：" + error.message);
    } finally {
      syncing = false;
    }
  }

  save = function () {
    originalSave();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncCloudState, 350);
  };

  const loginForm = document.getElementById("loginForm");
  loginForm.onsubmit = async function (event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(loginForm));
    status("正在登录...", "working");
    const { error } = await client.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password
    });
    if (error) {
      status("登录失败", "error");
      return toast("登录失败，请检查邮箱和密码");
    }
    try {
      await loadCloudState();
      window.KERUIKANG_AUTH_SESSION?.releaseForceLogin?.();
      toast("登录成功，已连接云端库存");
    } catch (error) {
      status("读取库存失败", "error");
      toast(error.message);
    }
  };

  document.getElementById("logoutBtn").onclick = async function () {
    if (window.forceSignOutAndShowLogin) return window.forceSignOutAndShowLogin("logout");
    await client.auth.signOut({ scope: "local" });
    sessionStorage.removeItem("clinic-login");
    data.currentUserId = "";
    save();
    document.getElementById("loginScreen").classList.remove("hidden");
    status("已退出云端账号");
    toast("已退出登录");
  };

  client.auth.getSession().then(({ data: sessionData }) => {
    if (window.KERUIKANG_AUTH_SESSION?.shouldForceLogin?.()) {
      document.getElementById("loginScreen").classList.remove("hidden");
      status("请重新登录诊所账号");
      return;
    }
    if (sessionData.session) {
      loadCloudState().catch(error => {
        console.error(error);
        status("读取库存失败", "error");
        document.getElementById("loginScreen").classList.remove("hidden");
      });
    } else {
      document.getElementById("loginScreen").classList.remove("hidden");
      status("请使用诊所账号登录");
    }
  });
})();
