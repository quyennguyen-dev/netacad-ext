// ============================================================
// autoloop.js — LUỒNG THỐNG NHẤT: Cuộn từ trên xuống dưới
// Gặp gì xử lý nấy (video / tab / dialog / MCQ / next)
// Đã xử lý rồi thì KHÔNG làm lại
// FIX tabs: dùng string key ổn định (aria-label) thay vì DOM node
// ============================================================

(function () {
  "use strict";

  const { sleep, safeQuery, safeQueryAll, walkShadow,
          findNextBtn, findSubmitBtn, hasMcq, hasAnyQuestion,
          getPageSig, waitPageChange } = window.NetacadUtils;

  let _loopActive = false;

  // ── FLAG: đánh dấu element đã xử lý (video / dialog / mcq) ─
  function markDone(el, key) {
    try { el.dataset["netacadDone_" + key] = "1"; } catch(e) {}
  }
  function isDone(el, key) {
    try { return el.dataset["netacadDone_" + key] === "1"; } catch(e) { return false; }
  }

  // ── FLAG RIÊNG CHO TAB GROUP dùng string key ─────────────────
  // DOM node của tab bị re-render sau khi NetAcad reset active tab
  // → dataset trên node cũ mất → vòng lặp vô tận.
  // Giải pháp: key = ghép aria-label tất cả tab lại (ổn định dù re-render)
  const _doneTabGroups = new Set();

  function tabGroupKey(tabs) {
    return Array.from(tabs)
      .map(t => (t.getAttribute("aria-label") || t.textContent || "").trim())
      .filter(Boolean)
      .join("|");
  }

 function sendStatus(text) {
    try { chrome.runtime.sendMessage({ action: "autoLoopStatus", current: 0, text }).catch(() => {}); } catch(e) {}
    window._moduleCompleterStatus?.(text, -1);
    // THÊM DÒNG NÀY ĐỂ HIỂN THỊ TEXT CHO NÚT QUIZ BÊN PHẢI
    window._quizStatusUpdater?.(text); 
  }
  async function scrollToEl(el) {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(500);
    } catch(e) {}
  }

  // ── THU THẬP TẤT CẢ ELEMENT CẦN XỬ LÝ (top → bottom) ───────
  function collectAllHandleable() {
    const items = [];

    function addItem(el, type, extra) {
      if (!el || items.find(i => i.el === el)) return;
      let top = 0;
      try { top = el.getBoundingClientRect().top + window.scrollY; } catch(e) {}
      items.push({ el, type, top, ...extra });
    }

    // Videos
    walkShadow(document.body, root => {
      safeQueryAll(root, "video").forEach(v => addItem(v, "video"));
    });
    for (const iframe of safeQueryAll(document, "iframe")) {
      try {
        safeQueryAll(iframe.contentDocument || iframe.contentWindow?.document, "video")
          .forEach(v => addItem(v, "video"));
      } catch(e) {}
    }
    walkShadow(document.body, root => {
      safeQueryAll(root, 'material-icon[icon="play_circle_filled"]')
        .forEach(icon => addItem(icon, "video-icon"));
    });

    // Tab groups — key bằng aria-label, KHÔNG dùng DOM node làm key
    walkShadow(document.body, root => {
      const tabs = safeQueryAll(root,
        "button.tabs__nav-item-btn, button[role='tab'].js-tabs-nav-item-btn-click");
      if (tabs.length > 1) {
        const key = tabGroupKey(tabs);
        if (!key) return;
        if (_doneTabGroups.has(key)) return; // đã xử lý rồi, bỏ qua
        // Dùng tabs[0] làm el để scrollToEl, nhưng key thực sự là string
        addItem(tabs[0], "tab-group", { tabKey: key, allTabs: tabs });
      }
    });

    // Start button (bắt đầu quiz/activity)
    walkShadow(document.body, root => {
      safeQueryAll(root, "div.start-button.start, [role='button'].start-button")
        .forEach(b => addItem(b, "start-btn"));
    });

    // Open-dialog buttons
    walkShadow(document.body, root => {
      safeQueryAll(root, [
        "button.open-dialog",
        "button.btn-text.btn__action",
        "button.open-dialog.btn__action",
        "a.open-dialog",
      ].join(", ")).forEach(b => addItem(b, "dialog"));
    });

    // MCQ / matching
    walkShadow(document.body, root => {
      safeQueryAll(root, "mcq-view, matching-view, dnd-view")
        .forEach(v => addItem(v, "mcq"));
      safeQueryAll(root, '[class*="objectMatching__widget"]')
        .forEach(v => addItem(v, "mcq"));
      safeQueryAll(root, "matching-dropdown-view")
        .forEach(v => addItem(v, "mcq"));
    });

    items.sort((a, b) => a.top - b.top);
    return items;
  }

  // ── XỬ LÝ VIDEO ─────────────────────────────────────────────
  async function handleOneVideo(v) {
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
        await sleep(400);
        return true;
      }
    } catch(e) {}
    return false;
  }

  async function handleOneVideoIcon(icon) {
    try {
      const target = icon.closest("button, a, [role='button']") || icon.parentElement;
      if (target) { target.click(); await sleep(400); return true; }
    } catch(e) {}
    return false;
  }

  // ── XỬ LÝ TAB GROUP ─────────────────────────────────────────
  async function handleOneTabGroup(item) {
    const tabs = item.allTabs || [];
    if (tabs.length <= 1) return false;
    sendStatus(`🗂️ Mở ${tabs.length} tab...`);
    for (let i = 0; i < tabs.length; i++) {
      if (!_loopActive) break;
      try {
        const scrollY = window.scrollY;
        tabs[i].click();
        await sleep(700);
        window.scrollTo({ top: scrollY, behavior: "instant" });
      } catch(e) {}
    }
    // Đánh dấu bằng string key — bền vững qua re-render
    _doneTabGroups.add(item.tabKey);
    return true;
  }

  // ── XỬ LÝ OPEN-DIALOG ───────────────────────────────────────
  async function handleOneDialog(btn) {
    try {
      const originTabId = await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({ action: "getTabId" }, res => {
            resolve(res?.tabId || null);
          });
        } catch(e) { resolve(null); }
      });

      btn.click();
      await sleep(1800);

      if (originTabId) {
        await new Promise(resolve => {
          try {
            chrome.runtime.sendMessage(
              { action: "closeNewTabAndFocus", originTabId },
              () => resolve()
            );
          } catch(e) { resolve(); }
        });
        await sleep(400);
      }

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
      if (closed) await sleep(400);
      return true;
    } catch(e) {}
    return false;
  }

  // ── XỬ LÝ MCQ ───────────────────────────────────────────────
  async function handleMcq() {
    const scrape = window._netacadOriginalScrapeData || window.scrapeData;
    if (typeof scrape === "function") {
      sendStatus("🤖 AI đang phân tích câu hỏi...");
      await scrape();
    }

    let submitBtn = null;
    for (let i = 0; i < 80; i++) {
      if (!_loopActive) return false;
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
      sendStatus("✅ Đã submit câu hỏi");
      return true;
    }
    return false;
  }

  // ── XỬ LÝ NỘP BÀI CUỐI ─────────────────────────────────────
  async function handleFinalSubmit() {
    let clicked = false;
    walkShadow(document.body, root => {
      for (const el of safeQueryAll(root, "label, span, div, input, p")) {
        const txt = (el.innerText || el.value || "").toLowerCase().trim();
        if (txt.includes("yes, confirm my submission")) { el.click(); clicked = true; break; }
      }
    });
    if (clicked) await sleep(300);

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

  // ── DÙNG CHO NÚT "Quiz AI" — tự động lặp qua từng câu MCQ ──
  let _quizLoopActive = false;

  window.stopQuizLoop = function () {
    _quizLoopActive = false;
    window._moduleCompleterStatus?.("⏹ Quiz AI đã dừng.", 0);
  };

  window.answerCurrentQuestion = async function () {
    if (_quizLoopActive) return false;
    _quizLoopActive = true;
    window._isQuizLooping = true;

    const scrape = window._netacadOriginalScrapeData || window.scrapeData;
    let pageNum = 0;
    const MAX_PAGES = 500;

    while (_quizLoopActive && pageNum < MAX_PAGES) {
      pageNum++;
      sendStatus(`🧠 Quiz AI — trang ${pageNum}...`);

      // Không có câu hỏi nào → tìm Next hoặc kết thúc
      if (!hasAnyQuestion()) {
        const nextBtn = findNextBtn();
        if (!nextBtn) {
          const isFinal = await handleFinalSubmit();
          if (isFinal) { sendStatus("🎉 Đã nộp bài thành công!"); break; }
          sendStatus("✅ Quiz AI hoàn thành!");
          break;
        }
        const oldSig = getPageSig();
        nextBtn.click();
        const changed = await waitPageChange(oldSig, 8000, () => _quizLoopActive);
        if (!changed) { sendStatus("⚠️ Trang không đổi, dừng lại."); break; }
        await sleep(300);
        continue;
      }

      // Scrape + AI phân tích + tự click đáp án
      if (typeof scrape === "function") {
        sendStatus("🤖 AI đang phân tích câu hỏi...");
        await scrape();
      }

      // Chờ nút Submit xuất hiện (AI đã click đáp án xong)
      let submitBtn = null;
      for (let i = 0; i < 100; i++) {
        if (!_quizLoopActive) break;
        submitBtn = findSubmitBtn();
        if (submitBtn) break;
        await sleep(50);
      }

      // Fallback: click đại option đầu tiên nếu AI không click được
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
        sendStatus("✅ Đã submit — chờ trang mới...");
        const oldSig = getPageSig();
        const changed = await waitPageChange(oldSig, 5000, () => _quizLoopActive);

        // Kiểm tra nộp bài cuối
        const isFinal = await handleFinalSubmit();
        if (isFinal) { sendStatus("🎉 Đã nộp bài thành công!"); break; }

        if (!changed) {
          // Trang không đổi → thử bấm Next
          const nextBtn = findNextBtn();
          if (nextBtn) {
            const sig2 = getPageSig();
            nextBtn.click();
            await waitPageChange(sig2, 8000, () => _quizLoopActive);
          } else {
            sendStatus("✅ Quiz AI hoàn thành!");
            break;
          }
        }
      } else {
        // Không có submit: bấm Next sang trang khác
        sendStatus(`➡️ Bỏ qua trang ${pageNum} — tìm Next...`);
        const nextBtn = findNextBtn();
        if (!nextBtn) {
          const isFinal = await handleFinalSubmit();
          if (isFinal) { sendStatus("🎉 Đã nộp bài thành công!"); break; }
          sendStatus("✅ Quiz AI hoàn thành!");
          break;
        }
        const oldSig = getPageSig();
        nextBtn.click();
        const changed = await waitPageChange(oldSig, 8000, () => _quizLoopActive);
        if (!changed) { sendStatus("⚠️ Trang không đổi, dừng lại."); break; }
      }

      await sleep(300);
    }

    _quizLoopActive = false;
    window._isQuizLooping = false;
    return true;
  };

  // ── MAIN LOOP ───────────────────────────────────────────────
  window.startAutoRunLoop = async function () {
    if (_loopActive) return;
    const stored = await chrome.storage.sync.get(["geminiApiKey"]);
    if (!stored.geminiApiKey) return;

    _loopActive = true;
    window._isAutoLooping = true;
    _doneTabGroups.clear(); // reset khi bắt đầu run mới
    let pageNum = 0;
    const MAX_PAGES = 500;

    window.scrollTo({ top: 0, behavior: "instant" });
    await sleep(400);

    while (_loopActive && pageNum < MAX_PAGES) {
      pageNum++;
      sendStatus(`📄 Trang ${pageNum} — đang phân tích...`);

      let submittedMcq = false;

      for (let pass = 0; pass < 200 && _loopActive; pass++) {
        const items = collectAllHandleable();

        // Tìm item đầu tiên chưa xử lý
        // Tab group: kiểm tra _doneTabGroups (đã làm trong collectAllHandleable)
        // Các loại khác: kiểm tra dataset
        const pending = items.find(({ el, type }) => {
          if (type === "tab-group") return true; // collectAllHandleable đã lọc done rồi
          return !isDone(el, type);
        });

        if (!pending) break;

        const { el, type } = pending;
        await scrollToEl(el);

        if (type === "video") {
          sendStatus(`🎬 Trang ${pageNum} — tua video...`);
          await handleOneVideo(el);
          markDone(el, "video");

        } else if (type === "video-icon") {
          sendStatus(`🎬 Trang ${pageNum} — play video icon...`);
          await handleOneVideoIcon(el);
          markDone(el, "video-icon");

        } else if (type === "tab-group") {
          sendStatus(`🗂️ Trang ${pageNum} — click các tab...`);
          await handleOneTabGroup(pending); // markDone bên trong hàm

        } else if (type === "start-btn") {
          sendStatus(`▶️ Trang ${pageNum} — bấm Start...`);
          try { el.click(); } catch(e) {}
          markDone(el, "start-btn");
          await sleep(800); // chờ quiz load

        } else if (type === "dialog") {
          sendStatus(`📄 Trang ${pageNum} — mở PT Activity...`);
          await handleOneDialog(el);
          markDone(el, "dialog");

        } else if (type === "mcq") {
          sendStatus(`❓ Trang ${pageNum} — câu hỏi MCQ`);
          markDone(el, "mcq");
          const submitted = await handleMcq();
          if (submitted) {
            submittedMcq = true;
            await sleep(600);
            const oldSig = getPageSig();
            await waitPageChange(oldSig, 3000, () => _loopActive);
            const isFinal = await handleFinalSubmit();
            if (isFinal) {
              sendStatus("🎉 Đã nộp bài thành công!");
              _loopActive = false;
              break;
            }
            break;
          }
        }
      }

      if (!_loopActive) break;
      if (submittedMcq) continue;

      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(600);

      sendStatus(`➡️ Trang ${pageNum} — tìm nút Next...`);
      await sleep(300);

      const nextBtn = findNextBtn();
      if (!nextBtn) {
        sendStatus(`🏁 Kiểm tra nộp bài cuối...`);
        const isFinal = await handleFinalSubmit();
        if (isFinal) { sendStatus("🎉 Đã nộp bài thành công!"); break; }
        sendStatus("✅ Đã hoàn thành tất cả trang!");
        break;
      }

      const oldSig = getPageSig();
      nextBtn.click();
      const changed = await waitPageChange(oldSig, 8000, () => _loopActive);
      if (!changed) { sendStatus("⚠️ Trang không đổi sau Next, dừng lại."); break; }

      // Trang mới thực sự (Next) → scroll lên đầu + xóa tab cache trang cũ
      _doneTabGroups.clear();
      window.scrollTo({ top: 0, behavior: "instant" });
      await sleep(300);
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