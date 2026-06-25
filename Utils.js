// ============================================================
// utils.js — Các hàm dùng chung cho toàn bộ extension
// Gom logic trùng lặp từ scraper.js / autoloop.js / content.js
// ============================================================
(function () {
  "use strict";

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function safeQuery(root, sel) {
    try { return root?.querySelector?.(sel) || null; } catch (e) { return null; }
  }
  function safeQueryAll(root, sel) {
    try { return Array.from(root?.querySelectorAll?.(sel) || []); } catch (e) { return []; }
  }

  // Walk toàn bộ shadow DOM (đệ quy), gọi callback(root) cho mỗi node gặp được
  function walkShadow(root, callback) {
    if (!root) return;
    callback(root);
    for (const el of safeQueryAll(root, "*")) {
      if (el.shadowRoot) walkShadow(el.shadowRoot, callback);
    }
  }

  // ── TÌM NÚT NEXT (chuyển trang nội dung) ──────────────────
  function findNextBtn() {
    let found = null;
    walkShadow(document.body, root => {
      if (found) return;
      for (const btn of safeQueryAll(root, "button, a")) {
        if (btn.disabled || btn.getAttribute("aria-disabled") === "true") continue;
        const cls = (btn.className || "");
        const aria = btn.getAttribute("aria-label") || "";
        const title = btn.getAttribute("title") || "";

        // 1. Class chứa "next--" (Next button với class hash động, vd: next--3dfUb)
        if (cls.includes("next--")) { found = btn; break; }

        // 2. Class chứa cả "moduleNavBtn--" và "next" (vd: moduleNavBtn--sFwjV next--3dfUb)
        if (cls.includes("moduleNavBtn--") && cls.toLowerCase().includes("next")) {
          found = btn; break;
        }

        // 3. aria-label hoặc title dạng "Go To X.X. ..." (nút điều hướng sang trang kế)
        if (aria.startsWith("Go To ") || title.startsWith("Go To ")) {
          // Xác nhận là nút đi TIẾP (có icon mũi tên phải, không có mũi tên trái)
          if (btn.querySelector('[class*="right-arrow"], .icon-right-arrow')) {
            if (!btn.querySelector('[class*="left-arrow"], .icon-left-arrow')) {
              found = btn; break;
            }
          } else {
            // Không có icon nhưng aria/title rõ ràng là "Go To" → chấp nhận
            found = btn; break;
          }
        }

        // 4. Fallback: chỉ có icon mũi tên phải, không có mũi tên trái
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

  // ── KIỂM TRA CÓ MCQ TRÊN TRANG (chỉ các custom element) ────
  function hasMcq() {
    let found = false;
    walkShadow(document.body, root => {
      if (found) return;
      if (safeQuery(root, "mcq-view, matching-view, dnd-view")) found = true;
    });
    return found;
  }

  // ── KIỂM TRA CÓ BẤT KỲ DẠNG CÂU HỎI NÀO TRÊN TRANG ─────────
  // Bao gồm cả objectMatching (line matching - div thường) và dropdown matching,
  // hai dạng này KHÔNG nằm trong thẻ mcq-view/matching-view/dnd-view nên hasMcq() bỏ sót.
  function hasAnyQuestion() {
    let found = false;
    walkShadow(document.body, root => {
      if (found) return;
      if (safeQuery(root, "mcq-view, matching-view, dnd-view")) { found = true; return; }
      if (safeQuery(root, '[class*="objectMatching__widget"], .component__widget.objectMatching__widget')) { found = true; return; }
      if (safeQuery(root, ".dropdown__btn")) { found = true; return; }
    });
    return found;
  }

  function getPageSig() {
    return window.location.href + "||" + document.title;
  }

  function waitPageChange(oldSig, timeout = 8000, isActiveFn = () => true) {
    return new Promise(resolve => {
      const end = Date.now() + timeout;
      function poll() {
        if (!isActiveFn()) { resolve(false); return; }
        if (getPageSig() !== oldSig) { setTimeout(() => resolve(true), 700); return; }
        if (Date.now() > end) { resolve(false); return; }
        setTimeout(poll, 120);
      }
      setTimeout(poll, 400);
    });
  }

  // ── TẠO NÚT DẠNG "PILL" DÙNG CHUNG CHO CÁC PANEL ───────────
  function makePillBtn(emoji, label, gradient, shadow) {
    const btn = document.createElement("button");
    btn.innerHTML = `${emoji} <span style="font-size:12px;font-weight:650;">${label}</span>`;
    btn.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 9px 16px;
      border: none;
      border-radius: 50px;
      background: ${gradient};
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      box-shadow: ${shadow};
      transition: transform 0.18s, opacity 0.18s;
      outline: none;
      white-space: nowrap;
      letter-spacing: 0.01em;
    `;
    btn.onmouseover = () => { btn.style.transform = "translateY(-2px)"; btn.style.opacity = "0.9"; };
    btn.onmouseout  = () => { btn.style.transform = "translateY(0)";    btn.style.opacity = "1";   };
    return btn;
  }

  window.NetacadUtils = {
    sleep, safeQuery, safeQueryAll, walkShadow,
    findNextBtn, findSubmitBtn, hasMcq, hasAnyQuestion,
    getPageSig, waitPageChange, makePillBtn
  };
})();