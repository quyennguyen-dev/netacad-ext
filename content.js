console.log("[NetAcad] content.js loaded");

let _debounce;
function debouncedScrape() {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => {
    // NGĂN XUNG ĐỘT KÉP: Bỏ qua hoàn toàn hành động dò trang chạy nền nếu đang ở chế độ Start Auto Run
    if (window._isAutoLooping) return; 

    try {
      chrome.storage.sync.get(["processOnSwitch"], (r) => {
        if (chrome.runtime.lastError) return;
        if (r.processOnSwitch === false) return;
        if (typeof window.scrapeData === "function") window.scrapeData();
      });
    } catch (e) {
      console.debug("[NetAcad] Context invalidated.");
    }
  }, 40); 
}

function initMutationObserver() {
  const appRoot = document.querySelector("app-root");
  if (!appRoot?.shadowRoot) return;
  const pageView = appRoot.shadowRoot.querySelector("page-view");
  if (!pageView?.shadowRoot) return;
  new MutationObserver(() => debouncedScrape())
    .observe(pageView.shadowRoot, { childList: true, subtree: true });
  console.debug("[NetAcad] MutationObserver active");
}

if (typeof window.scrapeData !== "function" && typeof scrapeData === "function") {
  window.scrapeData = scrapeData;
}


// ── PANEL GỘP: Auto Run + Complete Modules ─────────────────────────────────
function injectPanel() {
  if (document.getElementById("netacad-panel")) return;

  const panel = document.createElement("div");
  panel.id = "netacad-panel";
  panel.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 24px;
    z-index: 2147483640;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  `;

  // Status badge
  const badge = document.createElement("div");
  badge.id = "netacad-status-badge";
  badge.style.cssText = `
    display: none;
    background: rgba(15,23,42,0.92);
    color: #f1f5f9;
    font-size: 11px;
    font-weight: 500;
    padding: 5px 11px;
    border-radius: 20px;
    max-width: 220px;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  // Button factory
  function makeBtn(id, emoji, label, color, shadow) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.innerHTML = `${emoji} <span>${label}</span>`;
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 10px 18px;
      border: none;
      border-radius: 50px;
      background: ${color};
      color: #fff;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
      box-shadow: ${shadow};
      transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s;
      outline: none;
      white-space: nowrap;
      letter-spacing: 0.01em;
    `;
    btn.onmouseover = () => { btn.style.transform = "translateY(-2px)"; btn.style.opacity = "0.92"; };
    btn.onmouseout  = () => { btn.style.transform = "translateY(0)";    btn.style.opacity = "1"; };
    return btn;
  }

  const autoBtn = makeBtn(
    "netacad-auto-btn", "🚀", "Start Auto Run",
    "linear-gradient(135deg,#10b981,#059669)",
    "0 4px 14px rgba(16,185,129,0.4)"
  );

  const modBtn = makeBtn(
    "netacad-module-btn", "📚", "Complete Modules",
    "linear-gradient(135deg,#8b5cf6,#7c3aed)",
    "0 4px 14px rgba(139,92,246,0.4)"
  );

  panel.appendChild(badge);
  panel.appendChild(modBtn);
  panel.appendChild(autoBtn);
  document.body.appendChild(panel);

  // ── Status helper ────────────────────────────────────────
  function showBadge(msg) {
    badge.textContent = msg;
    badge.style.display = "block";
  }
  function hideBadge() {
    badge.style.display = "none";
  }

  // ── Module completer status callback ────────────────────
  window._moduleCompleterStatus = function(msg, remaining) {
    showBadge(msg);
    if (remaining === 0) setTimeout(hideBadge, 3000);
  };

  // ── AUTO RUN button ──────────────────────────────────────
  let autoRunning = false;

  window.updateFloatingButtonState = function(running) {
    autoRunning = running;
    if (running) {
      autoBtn.innerHTML = '⏹ <span>Stop Auto Run</span>';
      autoBtn.style.background = "linear-gradient(135deg,#ef4444,#dc2626)";
      autoBtn.style.boxShadow = "0 4px 14px rgba(239,68,68,0.4)";
    } else {
      autoBtn.innerHTML = '🚀 <span>Start Auto Run</span>';
      autoBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
      autoBtn.style.boxShadow = "0 4px 14px rgba(16,185,129,0.4)";
    }
  };

  autoBtn.addEventListener("click", async () => {
    try {
      if (!autoRunning) {
        const stored = await chrome.storage.sync.get(["geminiApiKey"]);
        if (!stored.geminiApiKey) {
          alert("⚠️ Vui lòng nhập API Key trong popup extension trước!");
          return;
        }
        window.updateFloatingButtonState(true);
        showBadge("🤖 Auto Run đang chạy...");
        if (typeof window.startAutoRunLoop === "function") {
          window.startAutoRunLoop().then(() => {
            window.updateFloatingButtonState(false);
            hideBadge();
          });
        }
      } else {
        if (typeof window.stopAutoRunLoop === "function") window.stopAutoRunLoop();
        window.updateFloatingButtonState(false);
        hideBadge();
      }
    } catch (err) {
      if (err.message?.includes("context invalidated")) {
        alert("🔄 Extension vừa cập nhật. Nhấn F5 để reload!");
      }
    }
  });

  // ── COMPLETE MODULES button ──────────────────────────────
  let modRunning = false;

  modBtn.addEventListener("click", async () => {
    try {
      if (!modRunning) {
        modRunning = true;
        modBtn.innerHTML = '⏹ <span>Dừng lại</span>';
        modBtn.style.background = "linear-gradient(135deg,#ef4444,#dc2626)";
        modBtn.style.boxShadow = "0 4px 14px rgba(239,68,68,0.4)";
        showBadge("🔍 Đang khởi động...");

        if (typeof window.startModuleCompleter === "function") {
          await window.startModuleCompleter();
        } else {
          showBadge("❌ Module chưa load, thử F5!");
          setTimeout(hideBadge, 3000);
        }

        modRunning = false;
        modBtn.innerHTML = '📚 <span>Complete Modules</span>';
        modBtn.style.background = "linear-gradient(135deg,#8b5cf6,#7c3aed)";
        modBtn.style.boxShadow = "0 4px 14px rgba(139,92,246,0.4)";
      } else {
        if (typeof window.stopModuleCompleter === "function") window.stopModuleCompleter();
        modRunning = false;
        modBtn.innerHTML = '📚 <span>Complete Modules</span>';
        modBtn.style.background = "linear-gradient(135deg,#8b5cf6,#7c3aed)";
        modBtn.style.boxShadow = "0 4px 14px rgba(139,92,246,0.4)";
        hideBadge();
      }
    } catch (err) {
      modRunning = false;
      if (err.message?.includes("context invalidated")) {
        alert("🔄 Extension vừa cập nhật. Nhấn F5 để reload!");
      }
    }
  });
}

(async () => {
  if (!document.querySelector("app-root")) return;
  if (document.readyState !== "complete") {
    await new Promise(r => window.addEventListener("load", r, { once: true }));
  }
  await new Promise(r => setTimeout(r, 40)); 

  try {
    const s = await chrome.storage.sync.get(["geminiApiKey", "showAnswers"]);
    if (s.geminiApiKey && s.showAnswers !== false) {
      if (typeof window.scrapeData === "function") {
        await window.scrapeData();
        initMutationObserver();
      }
    }
  } catch (e) {}

  injectPanel();
})();

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.action === "processPage") {
    if (!document.querySelector("app-root")) return false;
    if (req.showAnswers === false) { sendResponse({ success: true, result: false }); return false; }
    if (typeof window.scrapeData !== "function") {
      sendResponse({ success: false, error: "scrapeData not found" }); return false;
    }
    window.scrapeData()
      .then(r => sendResponse({ success: true, result: r }))
      .catch(e => sendResponse({ success: false, error: String(e) }));
    return true;
  }

  if (req.action === "startAutoLoop") {
    if (!document.querySelector("app-root")) {
      sendResponse({ started: false, error: "app-root not found" }); return false;
    }
    if (typeof window.startAutoRunLoop !== "function") {
      sendResponse({ started: false, error: "autoloop module not loaded" }); return false;
    }
    sendResponse({ started: true });
    if (typeof window.updateFloatingButtonState === "function") window.updateFloatingButtonState(true);

    window.startAutoRunLoop().then(count => {
      if (typeof window.updateFloatingButtonState === "function") window.updateFloatingButtonState(false);
      chrome.runtime.sendMessage({ action: "autoLoopFinished", count }).catch(() => {});
    });
    return false;
  }

  if (req.action === "stopAutoLoop") {
    if (typeof window.stopAutoRunLoop === "function") window.stopAutoRunLoop();
    if (typeof window.updateFloatingButtonState === "function") window.updateFloatingButtonState(false);
    sendResponse({ stopped: true });
    return false;
  }
  return false;
});