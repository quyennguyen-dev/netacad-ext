// ============================================================
// autoloop.js — LUỒNG THỐNG NHẤT: Cuộn từ trên xuống dưới
// Gặp gì xử lý nấy: Video → Dialog → MCQ → Next
// ============================================================

(function () {
  "use strict";

  let _loopActive = false;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function safeQuery(root, sel) {
    try { return root?.querySelector?.(sel) || null; } catch(e) { return null; }
  }
  function safeQueryAll(root, sel) {
    try { return Array.from(root?.querySelectorAll?.(sel) || []); } catch(e) { return []; }
  }

  // Walk toàn bộ shadow DOM, gọi callback(root) mỗi node
  function walkShadow(root, callback) {
    if (!root) return;
    callback(root);
    for (const el of safeQueryAll(root, "*")) {
      if (el.shadowRoot) walkShadow(el.shadowRoot, callback);
    }
  }

  function sendStatus(text) {
    try { chrome.runtime.sendMessage({ action: "autoLoopStatus", current: 0, text }).catch(() => {}); } catch(e) {}
    window._moduleCompleterStatus?.(text, -1);
  }

  // ── Lấy signature trang hiện tại ───────────────────────────
  function getPageSig() {
    return window.location.href + "||" + document.title;
  }

  function waitPageChange(oldSig, timeout = 8000) {
    return new Promise(resolve => {
      const end = Date.now() + timeout;
      function poll() {
        if (!_loopActive) { resolve(false); return; }
        if (getPageSig() !== oldSig) { setTimeout(() => resolve(true), 700); return; }
        if (Date.now() > end) { resolve(false); return; }
        setTimeout(poll, 120);
      }
      setTimeout(poll, 400);
    });
  }

  // ── TÌM NÚT NEXT (chuyển trang nội dung) ──────────────────
  function findNextBtn() {
    let found = null;
    walkShadow(document.body, root => {
      if (found) return;
      for (const btn of safeQueryAll(root, "button, a")) {
        if (btn.disabled || btn.getAttribute("aria-disabled") === "true") continue;
        const cls = (btn.className || "");
        const txt = (btn.innerText || btn.getAttribute("aria-label") || "").toLowerCase().trim();
        // Selector chính xác từ DOM NetAcad
        if (cls.includes("next--") || cls.includes("moduleNavBtn--") && cls.includes("next")) {
          found = btn; break;
        }
        // Fallback theo aria-label "Go To ..."
        if (btn.getAttribute("aria-label")?.startsWith("Go To ")) {
          // Chỉ lấy nút next, không lấy prev
          if (cls.toLowerCase().includes("next") || btn.querySelector('[class*="right-arrow"], .icon-right-arrow')) {
            found = btn; break;
          }
        }
        // Fallback icon right-arrow bên trong
        if (btn.querySelector('[class*="right-arrow"], .icon-right-arrow')) {
          if (!btn.querySelector('[class*="left-arrow"], .icon-left-arrow')) {
            found = btn; break;
          }
        }
      }
    });
    return found;
  }

  // ── TÌM NÚT SUBMIT MCQ ─────────────────────────────────────
  function findSubmitBtn() {
    let found = null;
    walkShadow(document.body, root => {
      if (found) return;
      const byClass = safeQuery(root, "button.submit-button:not([disabled])");
      if (byClass) { found = byClass; return; }
      const byAria = safeQuery(root, 'button[aria-label="submit"]:not([disabled])');
      if (byAria) { found = byAria; return; }
    });
    return found;
  }

  // ── KIỂM TRA CÓ MCQ TRÊN TRANG ────────────────────────────
  function hasMcq() {
    let found = false;
    walkShadow(document.body, root => {
      if (found) return;
      if (safeQuery(root, "mcq-view, matching-view, dnd-view")) found = true;
    });
    return found;
  }

  // ── XỬ LÝ VIDEO: tua đến cuối ──────────────────────────────
  async function handleVideos() {
    const videos = [];
    walkShadow(document.body, root => {
      safeQueryAll(root, "video").forEach(v => { if (!videos.includes(v)) videos.push(v); });
    });
    // Tìm trong iframe (Brightcove)
    for (const iframe of safeQueryAll(document, "iframe")) {
      try {
        safeQueryAll(iframe.contentDocument || iframe.contentWindow?.document, "video")
          .forEach(v => { if (!videos.includes(v)) videos.push(v); });
      } catch(e) {}
    }

    let count = 0;
    for (const v of videos) {
      try {
        if (v.readyState < 1) {
          await Promise.race([
            new Promise(r => v.addEventListener("loadedmetadata", r, { once: true })),
            sleep(3000)
          ]);
        }
        if (v.duration && isFinite(v.duration)) {
          v.currentTime = v.duration * 0.99;
          v.dispatchEvent(new Event("timeupdate", { bubbles: true }));
          v.dispatchEvent(new Event("ended",      { bubbles: true }));
          count++;
          await sleep(400);
        }
      } catch(e) {}
    }

    // Fallback: click play_circle_filled icon
    if (count === 0) {
      walkShadow(document.body, root => {
        safeQueryAll(root, 'material-icon[icon="play_circle_filled"]').forEach(icon => {
          try {
            const target = icon.closest("button, a, [role='button']") || icon.parentElement;
            if (target) { target.click(); count++; }
          } catch(e) {}
        });
      });
    }

    return count;
  }

  // ── XỬ LÝ OPEN-DIALOG (PT Activity / bài đọc) ──────────────
  async function handleOpenDialogs() {
    const btns = [];
    walkShadow(document.body, root => {
      safeQueryAll(root, "button.open-dialog, button.open-dialog.btn__action").forEach(b => {
        if (!btns.includes(b)) btns.push(b);
      });
    });

    for (const btn of btns) {
      try {
        btn.click();
        await sleep(1500);
        // Tìm và đóng dialog
        let closed = false;
        walkShadow(document.body, root => {
          if (closed) return;
          for (const b of safeQueryAll(root, "button")) {
            const txt = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase().trim();
            if (txt === "close" || txt === "dismiss" || txt === "đóng" || txt === "×") {
              b.click(); closed = true; break;
            }
          }
        });
        await sleep(400);
      } catch(e) {}
    }
    return btns.length;
  }

  // ── XỬ LÝ MCQ: gọi AI, click đáp án, submit ────────────────
  async function handleMcq(apiKey) {
    // Dùng scrapeData đã có — nó gọi AI + click đáp án
    const scrape = window._netacadOriginalScrapeData || window.scrapeData;
    if (typeof scrape === "function") {
      sendStatus("🤖 AI đang phân tích câu hỏi...");
      await scrape();
    }

    // Chờ nút Submit xuất hiện (tối đa 4s)
    let submitBtn = null;
    for (let i = 0; i < 80; i++) {
      if (!_loopActive) return false;
      submitBtn = findSubmitBtn();
      if (submitBtn) break;
      await sleep(50);
    }

    // Fallback: force click đáp án đầu tiên nếu AI không chọn được
    if (!submitBtn) {
      let forced = false;
      walkShadow(document.body, root => {
        if (forced) return;
        const mcq = safeQuery(root, "mcq-view");
        if (mcq?.shadowRoot) {
          const labels = safeQueryAll(mcq.shadowRoot, ".mcq__item-label, label");
          if (labels.length > 0) { try { labels[0].click(); forced = true; } catch(e) {} }
        }
      });
      await sleep(500);
      submitBtn = findSubmitBtn();
    }

    if (submitBtn) {
      submitBtn.click();
      sendStatus("✅ Đã submit câu hỏi");
      return true;
    }
    return false;
  }

  // ── XỬ LÝ XÁC NHẬN NỘP BÀI CUỐI ───────────────────────────
  async function handleFinalSubmit() {
    // Click "Yes, confirm my submission" checkbox nếu có
    let clicked = false;
    walkShadow(document.body, root => {
      for (const el of safeQueryAll(root, "label, span, div, input, p")) {
        const txt = (el.innerText || el.value || "").toLowerCase().trim();
        if (txt.includes("yes, confirm my submission")) { el.click(); clicked = true; break; }
      }
    });
    if (clicked) await sleep(300);

    // Click nút Submit Assessment
    let submitted = false;
    walkShadow(document.body, root => {
      if (submitted) return;
      for (const btn of safeQueryAll(root, "button")) {
        const txt = (btn.innerText || btn.getAttribute("aria-label") || "").toLowerCase().trim();
        if ((txt === "submit" || txt === "submit my assessment") && !btn.disabled) {
          btn.click(); submitted = true; break;
        }
      }
    });
    return clicked || submitted;
  }

  // ── MAIN LOOP ───────────────────────────────────────────────
  window.startAutoRunLoop = async function () {
    if (_loopActive) return;
    const stored = await chrome.storage.sync.get(["geminiApiKey"]);
    if (!stored.geminiApiKey) return;

    _loopActive = true;
    window._isAutoLooping = true;
    let pageNum = 0;
    const MAX_PAGES = 500;

    while (_loopActive && pageNum < MAX_PAGES) {
      pageNum++;
      sendStatus(`📄 Trang ${pageNum} — đang phân tích...`);

      // ── BƯỚC 1: Xử lý video nếu có ──
      const hasVideo = document.querySelector("video") ||
        (() => { let f = false; walkShadow(document.body, r => { if (!f && safeQuery(r, 'material-icon[icon="play_circle_filled"]')) f = true; }); return f; })();

      if (hasVideo) {
        sendStatus(`🎬 Trang ${pageNum} — tua video...`);
        await handleVideos();
        await sleep(600);
      }

      // ── BƯỚC 2: Xử lý open-dialog nếu có ──
      let hasDialogs = false;
      walkShadow(document.body, root => { if (safeQuery(root, "button.open-dialog")) hasDialogs = true; });
      if (hasDialogs) {
        sendStatus(`📄 Trang ${pageNum} — mở PT Activity...`);
        await handleOpenDialogs();
        await sleep(400);
      }

      // ── BƯỚC 3: Xử lý MCQ nếu có ──
      if (hasMcq()) {
        sendStatus(`❓ Trang ${pageNum} — câu hỏi MCQ`);
        const submitted = await handleMcq(stored.geminiApiKey);
        if (submitted) {
          await sleep(600);
          // Sau submit MCQ, chờ trang load lại (có thể sang câu tiếp hoặc trang tiếp)
          const oldSig = getPageSig();
          await waitPageChange(oldSig, 3000);
          // Kiểm tra xem có phải trang nộp bài cuối không
          const isFinal = await handleFinalSubmit();
          if (isFinal) {
            sendStatus("🎉 Đã nộp bài thành công!");
            break;
          }
          continue; // Vòng lặp tiếp theo xử lý trang mới
        }
      }

      // ── BƯỚC 4: Bấm Next để sang trang tiếp ──
      sendStatus(`➡️ Trang ${pageNum} — tìm nút Next...`);
      await sleep(300);

      const nextBtn = findNextBtn();
      if (!nextBtn) {
        // Thử xác nhận nộp bài cuối
        sendStatus(`🏁 Kiểm tra nộp bài cuối...`);
        const isFinal = await handleFinalSubmit();
        if (isFinal) {
          sendStatus("🎉 Đã nộp bài thành công!");
          break;
        }
        // Không có Next, không có Submit → đã xong
        sendStatus("✅ Đã hoàn thành tất cả trang!");
        break;
      }

      const oldSig = getPageSig();
      nextBtn.click();
      const changed = await waitPageChange(oldSig, 8000);
      if (!changed) {
        sendStatus("⚠️ Trang không đổi sau Next, dừng lại.");
        break;
      }
    }

    _loopActive = false;
    window._isAutoLooping = false;
  };

  window.stopAutoRunLoop = function () {
    _loopActive = false;
    window._isAutoLooping = false;
    window._moduleCompleterStatus?.("⏹ Đã dừng.", 0);
  };

  // Alias cho module-completer (nút Complete Modules giờ cũng chạy luồng này)
  window.startModuleCompleter = window.startAutoRunLoop;
  window.stopModuleCompleter  = window.stopAutoRunLoop;

  if (typeof scrapeData === "function") window._netacadOriginalScrapeData = scrapeData;
  else if (typeof window.scrapeData === "function") window._netacadOriginalScrapeData = window.scrapeData;

})();