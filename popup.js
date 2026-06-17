document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  const apiKeyInput        = $("apiKey");
  const saveKeyBtn         = $("saveKey");
  const showAnswersTgl     = $("showAnswersToggle");
  const processOnSwitchTgl = $("processOnSwitchToggle");
  const statusDiv          = $("status");

  function setStatus(msg, clearAfterMs = 0) {
    statusDiv.textContent = msg;
    if (clearAfterMs) setTimeout(() => { statusDiv.textContent = ""; }, clearAfterMs);
  }

  // ── Load cấu hình đã lưu từ Bộ nhớ Chrome ─────────────────────────
  chrome.storage.sync.get(["geminiApiKey", "showAnswers", "processOnSwitch"], r => {
    if (r.geminiApiKey) apiKeyInput.value = r.geminiApiKey;
    showAnswersTgl.checked     = r.showAnswers !== false;
    processOnSwitchTgl.checked = r.processOnSwitch !== false;
  });

  // Lắng nghe sự thay đổi của công tắc gợi ý
  showAnswersTgl.addEventListener("change", () =>
    chrome.storage.sync.set({ showAnswers: showAnswersTgl.checked }));
    
  // Lắng nghe sự thay đổi của công tắc đổi trang
  processOnSwitchTgl.addEventListener("change", () =>
    chrome.storage.sync.set({ processOnSwitch: processOnSwitchTgl.checked }));

  // ── Xử lý lưu API Key ──────────────────────────────────────────
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) { setStatus("⚠️ Vui lòng nhập API Key!", 2000); return; }
    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      setStatus("✅ Đã lưu cấu hình thành công!", 2000);
    });
  });
});