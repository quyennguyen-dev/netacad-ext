// ============================================================
// content.js — ĐIỀU PHỐI CHÍNH
// Tách 2 panel độc lập: Quiz Panel (AI trả lời) & Auto Panel (automation)
// ============================================================
console.log("[NetAcad] content.js v2.1 loaded");

const { makePillBtn } = window.NetacadUtils;

// ── DEBOUNCED SCRAPE (Quiz auto-detect khi đổi trang) ────────
let _debounce;
function debouncedScrape() {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => {
    // SỬA DÒNG NÀY: Thêm window._isQuizLooping để chặn xung đột khi Quiz AI đang chạy
    if (window._isAutoLooping || window._isQuizLooping) return; 
    try {
      chrome.storage.sync.get(["processOnSwitch"], (r) => {
        if (chrome.runtime.lastError || r.processOnSwitch === false) return;
        if (typeof window.scrapeData === "function") window.scrapeData();
      });
    } catch (e) {
      console.debug("[NetAcad] Context invalidated.");
    }
  }, 400);
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

// ── PANEL QUIZ (góc phải dưới) ────────────────────────────────
// Trả lời câu hỏi hiện tại bằng AI rồi TỰ ĐỘNG SUBMIT để qua câu mới
function injectQuizPanel() {
  if (document.getElementById("netacad-quiz-panel")) return;

  const panel = document.createElement("div");
  panel.id = "netacad-quiz-panel";
  panel.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483640;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
  `;

  // Status badge
  const badge = document.createElement("div");
  badge.id = "netacad-quiz-badge";
  badge.style.cssText = `
    display: none;
    background: rgba(15,23,42,0.88);
    color: #f1f5f9;
    font-size: 11px;
    font-weight: 500;
    padding: 5px 12px;
    border-radius: 20px;
    max-width: 220px;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  // Nút Quiz AI (xanh dương)
  const quizBtn = makePillBtn(
    "🧠", "Quiz AI",
    "linear-gradient(135deg,#3b82f6,#2563eb)",
    "0 4px 14px rgba(59,130,246,0.4)"
  );

  panel.appendChild(badge);
  panel.appendChild(quizBtn);
  document.body.appendChild(panel);

  let quizRunning = false;

  function setQuizRunningUI() {
    quizBtn.innerHTML = `⏹ <span style="font-size:12px;font-weight:650;">Stop Quiz</span>`;
    quizBtn.style.background = "linear-gradient(135deg,#f59e0b,#d97706)";
    quizBtn.style.boxShadow = "0 4px 14px rgba(245,158,11,0.4)";
  }
  function resetUI() {
    quizBtn.innerHTML = `🧠 <span style="font-size:12px;font-weight:650;">Quiz AI</span>`;
    quizBtn.style.background = "linear-gradient(135deg,#3b82f6,#2563eb)";
    quizBtn.style.boxShadow = "0 4px 14px rgba(59,130,246,0.4)";
  }
window._quizStatusUpdater = function(msg) {
    badge.textContent = msg;
    badge.style.display = "block";
  };
  quizBtn.addEventListener("click", async () => {
    try {
      // Đang chạy → Stop
      if (quizRunning) {
        if (typeof window.stopQuizLoop === "function") window.stopQuizLoop();
        quizRunning = false;
        resetUI();
        badge.textContent = "⏹ Đã dừng Quiz AI.";
        setTimeout(() => { badge.style.display = "none"; }, 2000);
        return;
      }

      const stored = await chrome.storage.sync.get(["geminiApiKey"]);
      if (!stored.geminiApiKey) {
        alert("⚠️ Vui lòng nhập API Key trong popup trước!");
        return;
      }

      quizRunning = true;
      setQuizRunningUI();
      badge.textContent = "🧠 Quiz AI đang chạy...";
      badge.style.display = "block";

      if (typeof window.answerCurrentQuestion === "function") {
        window.answerCurrentQuestion().then(() => {
          quizRunning = false;
          resetUI();
          badge.textContent = "✅ Quiz AI hoàn tất!";
          setTimeout(() => { badge.style.display = "none"; }, 2500);
        }).catch((err) => {
          console.error("[NetAcad] Quiz AI error:", err);
          quizRunning = false;
          resetUI();
          badge.textContent = "⚠️ Quiz AI gặp lỗi, đã dừng.";
          setTimeout(() => { badge.style.display = "none"; }, 3000);
        });
      } else if (typeof window.scrapeData === "function") {
        await window.scrapeData();
        quizRunning = false;
        resetUI();
        badge.textContent = "✅ Hoàn tất!";
        setTimeout(() => { badge.style.display = "none"; }, 2000);
      }
    } catch (err) {
      quizRunning = false;
      resetUI();
      if (err.message?.includes("context invalidated")) {
        alert("🔄 Extension vừa cập nhật. Nhấn F5 để reload!");
      }
    }
  });
}

// ── PANEL AUTO (góc trái dưới) ────────────────────────────────
// Chỉ còn 1 nút Auto Run (đã gộp với Complete Modules vì cùng chung 1 luồng autoloop)
function injectAutoPanel() {
  if (document.getElementById("netacad-auto-panel")) return;

  const panel = document.createElement("div");
  panel.id = "netacad-auto-panel";
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
  badge.id = "netacad-auto-badge";
  badge.style.cssText = `
    display: none;
    background: rgba(15,23,42,0.88);
    color: #f1f5f9;
    font-size: 11px;
    font-weight: 500;
    padding: 5px 12px;
    border-radius: 20px;
    max-width: 240px;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  // Nút Auto Run (xanh lá) — chạy toàn bộ module: video → dialog → MCQ → next
  const autoBtn = makePillBtn(
    "🚀", "Auto Run",
    "linear-gradient(135deg,#10b981,#059669)",
    "0 4px 14px rgba(16,185,129,0.4)"
  );

  panel.appendChild(badge);
  panel.appendChild(autoBtn);
  document.body.appendChild(panel);

  function showBadge(msg) { badge.textContent = msg; badge.style.display = "block"; }
  function hideBadge()    { badge.style.display = "none"; }

  // Status từ autoloop
  window._moduleCompleterStatus = function(msg, remaining) {
    showBadge(msg);
    if (remaining === 0) setTimeout(hideBadge, 2500);
  };

  let autoRunning = false;

  window.updateFloatingButtonState = function(running) {
    autoRunning = running;
    if (running) {
      autoBtn.innerHTML = `⏹ <span style="font-size:12px;font-weight:650;">Stop Auto</span>`;
      autoBtn.style.background = "linear-gradient(135deg,#ef4444,#dc2626)";
      autoBtn.style.boxShadow  = "0 4px 14px rgba(239,68,68,0.4)";
    } else {
      autoBtn.innerHTML = `🚀 <span style="font-size:12px;font-weight:650;">Auto Run</span>`;
      autoBtn.style.background = "linear-gradient(135deg,#10b981,#059669)";
      autoBtn.style.boxShadow  = "0 4px 14px rgba(16,185,129,0.4)";
    }
  };

  autoBtn.addEventListener("click", async () => {
    try {
      if (!autoRunning) {
        const stored = await chrome.storage.sync.get(["geminiApiKey"]);
        if (!stored.geminiApiKey) {
          alert("⚠️ Vui lòng nhập API Key trong popup trước!");
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
}

// ── KHỞI ĐỘNG ────────────────────────────────────────────────
(async () => {
  if (!document.querySelector("app-root")) return;
  if (document.readyState !== "complete") {
    await new Promise(r => window.addEventListener("load", r, { once: true }));
  }
  await new Promise(r => setTimeout(r, 60));

  try {
    const s = await chrome.storage.sync.get(["geminiApiKey", "showAnswers"]);
    if (s.geminiApiKey && s.showAnswers !== false) {
      if (typeof window.scrapeData === "function") {
        await window.scrapeData();
        initMutationObserver();
      }
    }
  } catch (e) {}

  injectQuizPanel(); // góc phải dưới
  injectAutoPanel(); // góc trái dưới
})();

// ── MESSAGE LISTENER ──────────────────────────────────────────
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