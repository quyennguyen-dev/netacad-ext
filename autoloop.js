// ============================================================
// autoloop.js — LUỒNG THỐNG NHẤT: Cuộn từ trên xuống dưới
// Gặp gì xử lý nấy: Video → Dialog → MCQ → Next
// ============================================================

(function () {
  "use strict";

  const { sleep, safeQuery, safeQueryAll, walkShadow,
          findNextBtn, findSubmitBtn, hasMcq,
          getPageSig, waitPageChange } = window.NetacadUtils;

  let _loopActive = false;

  function sendStatus(text) {
    try { chrome.runtime.sendMessage({ action: "autoLoopStatus", current: 0, text }).catch(() => {}); } catch(e) {}
    window._moduleCompleterStatus?.(text, -1);
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
  // Hàm này được dùng cho cả autoloop và nút "Quiz AI" (trả lời 1 câu rồi submit)
  async function handleMcq() {
    // Dùng scrapeData đã có — nó gọi AI + click đáp án
    const scrape = window._netacadOriginalScrapeData || window.scrapeData;
    if (typeof scrape === "function") {
      sendStatus("🤖 AI đang phân tích câu hỏi...");
      await scrape();
    }

    // Chờ nút Submit xuất hiện (tối đa 4s)
    let submitBtn = null;
    for (let i = 0; i < 80; i++) {
      if (window._isAutoLooping && !_loopActive) return false; // autoloop đã bị dừng giữa chừng
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

  // ── DÙNG CHO NÚT "Quiz AI": trả lời câu hiện tại rồi tự submit ──
  // Khác handleMcq ở chỗ: không phụ thuộc cờ _loopActive (chạy độc lập, 1 lần)
  window.answerCurrentQuestion = async function () {
    if (!hasMcq()) {
      // Không phải MCQ (có thể là matching) -> chỉ scrape, không submit
      const scrape = window._netacadOriginalScrapeData || window.scrapeData;
      if (typeof scrape === "function") await scrape();
      return false;
    }

    const scrape = window._netacadOriginalScrapeData || window.scrapeData;
    if (typeof scrape === "function") {
      sendStatus("🤖 AI đang phân tích câu hỏi...");
      await scrape();
    }

    let submitBtn = null;
    for (let i = 0; i < 80; i++) {
      submitBtn = findSubmitBtn();
      if (submitBtn) break;
      await sleep(50);
    }

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
      sendStatus("✅ Đã trả lời & nộp câu hỏi");
      // Chờ trang/câu hỏi đổi sang câu mới (không bắt buộc thành công)
      const oldSig = getPageSig();
      await waitPageChange(oldSig, 3000);
      return true;
    }
    sendStatus("⚠️ Không tìm thấy nút Submit");
    return false;
  };

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
        const submitted = await handleMcq();
        if (submitted) {
          await sleep(600);
          // Sau submit MCQ, chờ trang load lại (có thể sang câu tiếp hoặc trang tiếp)
          const oldSig = getPageSig();
          await waitPageChange(oldSig, 3000, () => _loopActive);
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
      const changed = await waitPageChange(oldSig, 8000, () => _loopActive);
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

  if (typeof scrapeData === "function") window._netacadOriginalScrapeData = scrapeData;
  else if (typeof window.scrapeData === "function") window._netacadOriginalScrapeData = window.scrapeData;

})();