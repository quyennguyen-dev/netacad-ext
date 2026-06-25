// ============================================================
// ui.js — HIỂN THỊ KẾT QUẢ AI + TỰ CLICK ĐÁP ÁN
// File này định nghĩa processSingleQuestion(viewElement, index, apiKey,
// providedAnswer, isMatching, qData) — hàm mà scraper.js gọi cho mỗi
// câu hỏi sau khi (hoặc trong khi) lấy đáp án từ AI.
//
// MỚI: mỗi khung hiển thị đáp án đều có nút "📋 Copy câu hỏi" và
// "📋 Copy đáp án" để người dùng copy nhanh ra ngoài (vd để tự tra
// hoặc lưu lại).
// ============================================================

(function () {
  "use strict";

  const U = window.NetacadUtils || {};
  const sleep = U.sleep || (ms => new Promise(r => setTimeout(r, ms)));

  if (!window.NetacadUtils) {
    console.error("[NetAcad] utils.js chưa load xong trước ui.js — kiểm tra thứ tự trong manifest.json");
  }

  // ── HELPERS CHUNG ───────────────────────────────────────────
  function normalize(s) {
    return (s || "").replace(/<!--.*?-->/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function fallbackCopy(text, cb) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text || "";
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (cb) cb();
    } catch (e) {}
  }

  function copyToClipboard(text, btnEl) {
    const feedback = () => {
      if (!btnEl) return;
      const old = btnEl.textContent;
      btnEl.textContent = "✅ Đã copy!";
      btnEl.disabled = true;
      setTimeout(() => { btnEl.textContent = old; btnEl.disabled = false; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text || "").then(feedback).catch(() => fallbackCopy(text, feedback));
    } else {
      fallbackCopy(text, feedback);
    }
  }

  function findMappedValue(mapping, cat) {
    if (!mapping) return null;
    if (mapping[cat] != null) return mapping[cat];
    const wanted = normalize(cat);
    const key = Object.keys(mapping).find(k => {
      const nk = normalize(k);
      return nk === wanted || nk.includes(wanted) || wanted.includes(nk);
    });
    return key ? mapping[key] : null;
  }

  function parseMatchingJson(raw) {
    try {
      if (!raw) return {};
      const cleaned = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
      const obj = JSON.parse(cleaned);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch (e) {}
    return {};
  }

  // ── XÂY DỰNG KHUNG UI (card) CHO 1 CÂU HỎI ─────────────────
  function cardStyle() {
    return `
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      border: 1px solid #dbeafe;
      border-left: 4px solid #3b82f6;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(15,23,42,0.08);
      padding: 10px 12px;
      margin: 8px 0;
      font-size: 13px;
      color: #1e293b;
      max-width: 560px;
      line-height: 1.45;
    `;
  }

  function smallBtnStyle() {
    return `
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      color: #334155;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 9px;
      border-radius: 6px;
      cursor: pointer;
      margin-right: 6px;
      margin-top: 6px;
    `;
  }

  function makeCopyBtn(label, getText) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = smallBtnStyle();
    btn.addEventListener("mousedown", e => e.preventDefault()); // tránh mất focus/selection trên trang
    btn.addEventListener("click", () => copyToClipboard(getText(), btn));
    return btn;
  }

  function renderBox(qData, index) {
    const box = document.createElement("div");
    box.className = "netacad-ai-assistant-ui";
    box.style.cssText = cardStyle();

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:8px;";

    const qWrap = document.createElement("div");
    qWrap.style.cssText = "flex:1;white-space:pre-wrap;word-break:break-word;";
    const qLabel = document.createElement("div");
    qLabel.textContent = `❓ Câu ${index + 1}`;
    qLabel.style.cssText = "font-weight:700;color:#0f172a;margin-bottom:2px;";
    const qText = document.createElement("div");
    qText.textContent = qData.questionText || "(không đọc được câu hỏi)";
    qText.style.cssText = "color:#334155;";
    qWrap.appendChild(qLabel);
    qWrap.appendChild(qText);

    header.appendChild(qWrap);
    box.appendChild(header);

    // Nút copy luôn hiện và lấy tất cả dữ liệu (câu hỏi + đáp án)
    const btnRow = document.createElement("div");
    btnRow.appendChild(makeCopyBtn("📋 Copy câu hỏi & lựa chọn", () => {
      let copyText = "";
      
      // 1. Lấy câu hỏi (nếu không có thì để chuỗi thông báo)
      if (qData.questionText && qData.questionText !== "Question text not found") {
        copyText += qData.questionText;
      } else {
        copyText += "(Không có nội dung câu hỏi)";
      }

      // 2. Lấy các đáp án trắc nghiệm (nếu có)
      if (qData.answerTexts && qData.answerTexts.length > 0) {
        copyText += "\n\nCác lựa chọn:\n" + qData.answerTexts.map((ans, i) => `${i + 1}. ${ans}`).join("\n");
      } 
      // 3. Lấy các mục của câu hỏi nối Matching (nếu có)
      else if (qData.isMatching) {
        if (qData.categories && qData.categories.length > 0) {
          copyText += "\n\nMục cần ghép:\n" + qData.categories.map(c => `- ${c}`).join("\n");
        }
        if (qData.options && qData.options.length > 0) {
          copyText += "\n\nLựa chọn đáp án:\n" + qData.options.map(o => `- ${o}`).join("\n");
        }
      }
      
      return copyText.trim();
    }));
    box.appendChild(btnRow);

    const answerArea = document.createElement("div");
    answerArea.style.cssText = "margin-top:6px;border-top:1px dashed #e2e8f0;padding-top:6px;";
    box.appendChild(answerArea);

    box._answerArea = answerArea;
    box._btnRow = btnRow;

    insertBoxNearQuestion(box, qData);
    return box;
  }
function insertBoxNearQuestion(box, qData) {
    let target = null;

    try {
        target = qData.questionTextElement;
    } catch (e) {}

    if (!target) {
        try {
            target = qData.viewElementForClick || qData.viewElement;
        } catch (e) {}
    }

    if (!target) {
        document.body.appendChild(box);
        return;
    }

    box.style.position = "relative";
    box.style.top = "";
    box.style.left = "";
    box.style.zIndex = "9999"; // Đảm bảo luôn nổi lên trên
    box.style.marginTop = "10px";

    try {
        const container = qData.viewElement || qData.viewElementForClick || target.parentElement;
        
        // FIX LỖI BỊ ẨN DO SHADOW DOM: 
        // 1. Nếu có shadowRoot, chèn thẳng vào shadowRoot để không bị ẩn
        if (container.shadowRoot) {
            container.shadowRoot.appendChild(box);
        } 
        // 2. Nếu không có shadowRoot, chèn ngay bên dưới (kế tiếp) container thay vì nhét vào trong
        else if (container.parentNode) {
            container.parentNode.insertBefore(box, container.nextSibling);
        } 
        // 3. Fallback
        else {
            container.appendChild(box);
        }
    } catch (e) {
        document.body.appendChild(box);
    }
}

  function showBoxStatus(box, text) {
    if (!box || !box._answerArea) return;
    box._answerArea.innerHTML = "";
    const div = document.createElement("div");
    div.textContent = text;
    div.style.cssText = "color:#64748b;font-style:italic;";
    box._answerArea.appendChild(div);
  }

  // ── MCQ: hiển thị + click đáp án ───────────────────────────
  function renderMcqAnswer(box, qData, answerText) {
    const area = box._answerArea;
    area.innerHTML = "";

    const label = document.createElement("div");
    const isError = typeof answerText === "string" && answerText.startsWith("Error");
    label.textContent = isError ? "⚠️ Lỗi AI:" : "✅ Đáp án AI:";
    label.style.cssText = `font-weight:600;color:${isError ? "#dc2626" : "#059669"};margin-bottom:2px;`;
    area.appendChild(label);

    const ansText = document.createElement("div");
    ansText.textContent = answerText || "(không có)";
    ansText.style.cssText = "white-space:pre-wrap;word-break:break-word;color:#0f172a;";
    area.appendChild(ansText);

    area.appendChild(makeCopyBtn("📋 Copy đáp án", () => answerText || ""));
  }

  async function applyMcqClicks(qData, answerText) {
    if (!answerText || typeof answerText !== "string") return;
    if (answerText.startsWith("Error")) return;
    const wanted = answerText.split(" /// ").map(s => normalize(s)).filter(Boolean);
    if (!wanted.length) return;

    const els = qData.answerElements ? Array.from(qData.answerElements) : [];
    for (const el of els) {
      try {
        const raw = (el.innerText || "").replace(/Option\s*\d*\s*of\s*\d*/gi, "").replace(/\b\d+\s+of\s+\d+\b/gi, "");
        const txt = normalize(raw);
        if (!txt) continue;
        if (wanted.some(w => txt === w || txt.includes(w) || w.includes(txt))) {
          el.click();
          await sleep(150);
        }
      } catch (e) {}
    }
  }

  // ── MATCHING: hiển thị mapping + click theo từng dạng ──────
  function renderMatchingAnswer(box, qData, mapping) {
    const area = box._answerArea;
    area.innerHTML = "";

    const keys = Object.keys(mapping || {});
    const label = document.createElement("div");
    label.textContent = keys.length ? "✅ Ghép đáp án AI:" : "⚠️ AI không trả về kết quả ghép hợp lệ.";
    label.style.cssText = `font-weight:600;color:${keys.length ? "#059669" : "#dc2626"};margin-bottom:2px;`;
    area.appendChild(label);

    const table = document.createElement("div");
    table.style.cssText = "color:#0f172a;";
    keys.forEach(cat => {
      const row = document.createElement("div");
      row.textContent = `• ${cat} → ${mapping[cat]}`;
      table.appendChild(row);
    });
    area.appendChild(table);

    if (keys.length) {
      area.appendChild(makeCopyBtn("📋 Copy đáp án", () =>
        keys.map(c => `${c} → ${mapping[c]}`).join("\n")
      ));
    }
  }

  function findOptionEl(root, text) {
    if (!root || !root.querySelectorAll) return null;
    const wanted = normalize(text);
    if (!wanted) return null;
    const opts = Array.from(root.querySelectorAll(".dropdown__item-inner"));
    return opts.find(o => normalize(o.innerText) === wanted) ||
           opts.find(o => normalize(o.innerText).includes(wanted) || wanted.includes(normalize(o.innerText)));
  }

  async function applyDropdownGroupClicks(qData, mapping) {
    const items = qData.dropdownGroupItems || [];
    for (const item of items) {
      const cat = item._netacadCategoryText;
      const optText = findMappedValue(mapping, cat);
      if (!optText) continue;
      try {
        const itemRoot = item.shadowRoot || item;
        const btn = itemRoot.querySelector(".dropdown__btn");
        if (!btn) continue;
        btn.click();
        await sleep(180);
        const optEl = findOptionEl(itemRoot, optText) || findOptionEl(document, optText);
        if (optEl) {
          optEl.click();
        } else {
          btn.click(); // đóng dropdown nếu không tìm được lựa chọn khớp
        }
        await sleep(180);
      } catch (e) {}
    }
  }

  async function applyDropdownClicks(qData, mapping) {
    const root = (qData.viewElement && (qData.viewElement.shadowRoot || qData.viewElement)) || null;
    if (!root || !root.querySelectorAll) return;
    const cats = Array.from(root.querySelectorAll(".matching__item-title_inner"));
    const btns = Array.from(root.querySelectorAll(".dropdown__btn"));
    for (let i = 0; i < cats.length && i < btns.length; i++) {
      const catText = cats[i].innerText;
      const optText = findMappedValue(mapping, catText);
      if (!optText) continue;
      try {
        btns[i].click();
        await sleep(180);
        const optEl = findOptionEl(document, optText) || findOptionEl(root, optText);
        if (optEl) optEl.click();
        await sleep(180);
      } catch (e) {}
    }
  }

  async function applyLineMatchingClicks(qData, mapping) {
    let catBtns = qData.categoryButtons ? Array.from(qData.categoryButtons) : [];
    let optBtns = qData.optionButtons ? Array.from(qData.optionButtons) : [];

    if ((!catBtns.length || !optBtns.length) && qData.viewElementForClick) {
      try {
        const root = qData.viewElementForClick.shadowRoot || qData.viewElementForClick;
        catBtns = Array.from(root.querySelectorAll("button.objectMatching-category-item"));
        optBtns = Array.from(root.querySelectorAll("button.objectMatching-option-item"));
      } catch (e) {}
    }
    if (!catBtns.length || !optBtns.length) return;

    for (let i = 0; i < catBtns.length; i++) {
      const catText = qData.categories[i];
      const optText = findMappedValue(mapping, catText);
      if (!optText) continue;
      const optIdx = (qData.options || []).findIndex(o => normalize(o) === normalize(optText));
      if (optIdx === -1 || !optBtns[optIdx]) continue;
      try {
        catBtns[i].click();
        await sleep(200);
        optBtns[optIdx].click();
        await sleep(300);
      } catch (e) {}
    }
  }

  function simulateDragDrop(source, target) {
    try {
      const dt = new DataTransfer();
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      source.dispatchEvent(new DragEvent("dragstart", opts));
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
      source.dispatchEvent(new DragEvent("dragend", opts));
    } catch (e) {}
  }

  async function applyDragDropClicks(qData, mapping) {
    const targets = qData.targetElements ? Array.from(qData.targetElements) : [];
    const sources = qData.sourceElements ? Array.from(qData.sourceElements) : [];
    for (let i = 0; i < targets.length; i++) {
      const catText = qData.categories[i];
      const optText = findMappedValue(mapping, catText);
      if (!optText) continue;
      const srcIdx = (qData.options || []).findIndex(o => normalize(o) === normalize(optText));
      if (srcIdx === -1 || !sources[srcIdx]) continue;
      try {
        simulateDragDrop(sources[srcIdx], targets[i]);
        await sleep(300);
      } catch (e) {}
    }
  }

  async function applyMatchingClicks(qData, mapping) {
    if (!mapping || !Object.keys(mapping).length) return;
    try {
      if (qData.isDropdownGroup) await applyDropdownGroupClicks(qData, mapping);
      else if (qData.isDropdown) await applyDropdownClicks(qData, mapping);
      else if (qData.isLineMatching) await applyLineMatchingClicks(qData, mapping);
      else await applyDragDropClicks(qData, mapping);
    } catch (e) {}
  }

  // ── REVIEW (đã nộp bài): hiển thị đáp án đúng có sẵn, không cần AI ──
  window.renderReviewAnswer = function (box, qData) {
    if (!box || !box._answerArea) return;
    const area = box._answerArea;
    area.innerHTML = "";

    const texts = qData.reviewAnswerTexts || [];

    const label = document.createElement("div");
    label.textContent = texts.length ? "✅ Đáp án đúng:" : "⚠️ Không đọc được đáp án đúng.";
    label.style.cssText = `font-weight:600;color:${texts.length ? "#059669" : "#dc2626"};margin-bottom:2px;`;
    area.appendChild(label);

    const ansText = document.createElement("div");
    ansText.textContent = texts.join(" /// ") || "(không có)";
    ansText.style.cssText = "white-space:pre-wrap;word-break:break-word;color:#0f172a;";
    area.appendChild(ansText);

    if (texts.length) {
      area.appendChild(makeCopyBtn("📋 Copy đáp án", () => texts.join("\n")));
    }
  };

  // ── HIỂN THỊ BOX NGAY KHI CÓ CÂU HỎI (trước khi AI chạy) ───
  // Gọi từ scraper.js NGAY khi vừa scrape xong 1 câu hỏi, để nút
  // "📋 Copy câu hỏi" xuất hiện ngay lập tức trên trang — không cần chờ
  // AI trả lời. Nếu box cho đúng qData này đã tồn tại rồi thì KHÔNG tạo
  // lại, chỉ trả về box cũ để các bước sau (processSingleQuestion) cập
  // nhật nội dung bên trong (answerArea), tránh tạo ra 2 khung rời nhau.
  window.ensureQuestionBox = function (qData, index) {
    try {
      // Chỉ giữ 1 box duy nhất đang hiển thị trên trang tại 1 thời điểm
      if (
        window._currentAiBox &&
        window._currentAiBox.isConnected &&
        window._currentAiBox !== qData._uiBox
      ) {
        window._currentAiBox.remove();
      }

      let box = qData._uiBox;
      if (!box || !box.isConnected) {
        box = renderBox(qData, index);
        qData._uiBox = box;
        showBoxStatus(box, "🤖 Đang chờ AI...");
      }

      window._currentAiBox = box;
      return box;
    } catch (e) {
      return null;
    }
  };

  // ── ĐIỂM VÀO CHÍNH — GỌI TỪ scraper.js ─────────────────────
  window.processSingleQuestion = async function (viewElement, index, apiKey, providedAnswer, isMatching, qData) {
    try {
      qData = qData || {};
      qData.viewElement = qData.viewElement || viewElement;

      // Dùng lại đúng 1 khung cho mỗi câu hỏi. Khung này có thể đã được
      // ensureQuestionBox() tạo từ trước (ngay khi scraper.js vừa scrape
      // xong câu hỏi, trước khi gọi AI) — ở đây ta CHỈ lấy lại / cập nhật
      // nội dung bên trong, KHÔNG tạo khung mới, để tránh tách thành 2
      // khung rời nhau trên trang.
      const box = window.ensureQuestionBox(qData, index);
      if (!box) return false;

      if (isMatching) {
        showBoxStatus(box, "🤖 AI đang phân tích matching...");
        let mapping = {};
        try {
          if (typeof window.getAiAnswer === "function") {
            const aiRaw = await window.getAiAnswer(
              qData.questionText,
              { categories: qData.categories || [], options: qData.options || [] },
              apiKey,
              true,
              qData.questionImages || []
            );
            mapping = parseMatchingJson(aiRaw);
          }
        } catch (e) {}
        renderMatchingAnswer(box, qData, mapping);
        await applyMatchingClicks(qData, mapping);
        return true;
      }

      // MCQ — providedAnswer có thể là cờ "đang xử lý" hoặc đáp án cuối cùng
      if (providedAnswer === "BATCH_PROCESSING_STARTED") {
        showBoxStatus(box, "🤖 AI đang phân tích...");
        return true;
      }

      renderMcqAnswer(box, qData, providedAnswer);
      await applyMcqClicks(qData, providedAnswer);
      return true;
    } catch (err) {
      console.error("[NetAcad] processSingleQuestion error:", err);
      return false;
    }
  };

})();