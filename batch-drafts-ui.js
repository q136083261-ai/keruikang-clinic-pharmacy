(function () {
  function totalSafe(medicine) {
    try {
      return typeof total === "function" ? total(medicine) : (medicine.batches || []).reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
    } catch {
      return 0;
    }
  }

  function draftExpiryLabel(draft) {
    if (!draft?.expiryDate) return "";
    const value = draft.expiryPrecision === "month" ? String(draft.expiryDate).slice(0, 7) : String(draft.expiryDate).slice(0, 10);
    return value ? `参考效期：${value}，未入库` : "";
  }

  function visibleMedicines() {
    try {
      return typeof filtered === "function" ? filtered(data.medicines) : data.medicines;
    } catch {
      return [];
    }
  }

  function decorateMedicineRows() {
    const rows = [...document.querySelectorAll("#medicineTable tr")];
    const medicines = visibleMedicines();
    rows.forEach((row, index) => {
      const medicine = medicines[index];
      if (!medicine || totalSafe(medicine) > 0 || !medicine.batchDraft?.expiryDate) return;
      if (row.querySelector(".batch-draft-tag")) return;
      const target = row.querySelector(".drug-name") || row.cells?.[0];
      const label = draftExpiryLabel(medicine.batchDraft);
      if (target && label) {
        target.insertAdjacentHTML("beforeend", `<span class="permission-tag batch-draft-tag">${label}</span>`);
      }
    });
  }

  const previousRenderMedicines = window.renderMedicines || renderMedicines;
  window.renderMedicines = renderMedicines = function () {
    previousRenderMedicines();
    decorateMedicineRows();
  };

  window.KERUIKANG_BATCH_DRAFTS_UI = {
    decorateMedicineRows,
    draftExpiryLabel
  };
})();
