window._isScrapingActive = false;
window._lastScrapedSignature = "";

// ── DẠNG MỚI: matching-dropdown-view ──────────────────────────
// Mỗi "dòng" (item) của câu hỏi matching dropdown giờ là 1 custom element
// riêng (<matching-dropdown-view>), có shadowRoot riêng — KHÔNG nằm gọn
// trong 1 shadowRoot chung như cấu trúc cũ (mcq-view/matching-view).
// group = { root, items: [<matching-dropdown-view>, ...] } được gom ở scrapeData().
function extractDropdownGroupQuestion(group) {
  const result = {
    isMatching: true,
    isDropdown: true,
    isDropdownGroup: true, // đánh dấu để nơi áp dụng đáp án (processSingleQuestion) biết cách click đúng
    questionText: "Question text not found",
    questionTextElement: null,
    answerElements: [],
    answerTexts: [],
    categories: [],
    options: [],
    targetElements: [],
    sourceElements: [],
    questionImages: [],
    dropdownGroupItems: group.items // lưu lại để engine click sau (mỗi item tự có shadowRoot riêng)
  };

  const root = group.root;
  const qSelectors = ".component__body-inner, .mcq__prompt, .prompt, .question-text";

  // 1. Tìm câu hỏi (instruction) — thường nằm CÙNG root với các item dropdown
  let qEl = null;
  try { qEl = root.querySelector ? root.querySelector(qSelectors) : null; } catch (e) {}

  // Nếu không thấy trong root hiện tại, thử dò lên vài cấp tổ tiên (light DOM)
  if (!qEl) {
    try {
      let anc = (root.host || root)?.parentElement;
      let depth = 0;
      while (anc && depth < 6 && !qEl) {
        qEl = anc.querySelector ? anc.querySelector(qSelectors) : null;
        anc = anc.parentElement;
        depth++;
      }
    } catch (e) {}
  }
  if (qEl) {
    result.questionTextElement = qEl;
    result.questionText = qEl.innerText.trim();
  }

  // 2. Thu thập hình ảnh (nếu có) trong cùng root
  try {
    const imgSelectors = 'img, [class*="graphic"] img, [class*="image"] img';
    const allImgs = root.querySelectorAll ? root.querySelectorAll(imgSelectors) : [];
    allImgs.forEach(img => {
      const src = img.src || img.getAttribute('src');
      if (src && !src.startsWith('data:') && src.length > 10) {
        result.questionImages.push(src);
      }
    });
  } catch (e) {}

  // 3. Mỗi item: category (nhãn bên trái) + options (đọc trực tiếp từ list ẩn, KHÔNG cần mở dropdown)
  group.items.forEach((item, idx) => {
    const itemRoot = item.shadowRoot || item;
    let catText = "";
    try {
      const titleEl = itemRoot.querySelector(".matching__item-title_inner");
      if (titleEl) catText = titleEl.innerText.replace(/<!--.*?-->/g, "").trim();
    } catch (e) {}
    if (!catText) catText = `Item ${idx + 1}`;
    result.categories.push(catText);
    item._netacadCategoryText = catText; // để engine map lại đúng item khi click chọn đáp án

    try {
      const optEls = itemRoot.querySelectorAll(".dropdown__item-inner");
      optEls.forEach(o => {
        const val = (o.getAttribute("value") || o.innerText.replace(/<!--.*?-->/g, "").trim());
        if (val && !result.options.includes(val)) result.options.push(val);
      });
    } catch (e) {}
  });

  // Đánh dấu đã xử lý để tránh chạy lại khi DOM thay đổi nhẹ (giống objectMatching)
  if (group.root._netacadDropdownGroupProcessed) {
    result._alreadyProcessed = true;
  }
  group.root._netacadDropdownGroupProcessed = true;

  return result;
}

async function extractQuestionAndAnswers(viewElement, index) {
  // ── DẠNG MỚI: matching-dropdown-view (mỗi dòng có shadowRoot riêng) ──
  // Được gom nhóm sẵn ở scrapeData() thành { _isDropdownGroupRoot, root, items }
  if (viewElement && viewElement._isDropdownGroupRoot) {
    return extractDropdownGroupQuestion(viewElement);
  }

  let result = {
    isMatching: false,
    isDropdown: false,
    isReview: false, // true = trang đã nộp bài, đáp án đúng có sẵn (không cần AI)
    reviewAnswerTexts: [],
    questionText: "Question text not found",
    questionTextElement: null,
    answerElements: [],
    answerTexts: [],
    categories: [], 
    options: [],
    targetElements: [], 
    sourceElements: []
  };

  if (!viewElement) return result;
  
  // objectMatching widget là div thường (không có shadowRoot)
  // mcq-view/matching-view là custom elements (có shadowRoot)
  const root = viewElement.shadowRoot || viewElement;
  const qSelectors = ".component__body-inner, .mcq__prompt, .prompt, .question-text";
  let qEl = root.querySelector(qSelectors);
  if (!qEl) {
     const baseView = root.querySelector('base-view[type="component"]');
     if (baseView?.shadowRoot) qEl = baseView.shadowRoot.querySelector(qSelectors);
  }
  if (qEl) {
     result.questionTextElement = qEl;
     result.questionText = qEl.innerText.trim();
  }

  // Thu thập hình ảnh trong câu hỏi (nếu có)
  result.questionImages = [];
  try {
    // Tìm tất cả img trong shadow root của câu hỏi
    const imgSelectors = 'img, [class*="graphic"] img, [class*="image"] img';
    const allImgs = root.querySelectorAll(imgSelectors);
    allImgs.forEach(img => {
      const src = img.src || img.getAttribute('src');
      if (src && !src.startsWith('data:') && src.length > 10) {
        result.questionImages.push(src);
      }
    });
    // Tìm thêm trong base-view nếu có
    const baseView = root.querySelector('base-view[type="component"]');
    if (baseView && baseView.shadowRoot) {
      baseView.shadowRoot.querySelectorAll(imgSelectors).forEach(img => {
        const src = img.src || img.getAttribute('src');
        if (src && !result.questionImages.includes(src)) {
          result.questionImages.push(src);
        }
      });
    }
  } catch(e) {}

  // 0. KIỂM TRA DẠNG OBJECT MATCHING (Line Matching - div thường, không có shadowRoot)
  const isObjectMatching = root.querySelectorAll('button.objectMatching-category-item').length > 0;
  if (isObjectMatching) {
      result.isMatching = true;
      result.isLineMatching = true;

      // Question text
      const qTextEl = root.querySelector('.component__body-inner, .objectMatching__body .component__body-inner');
      if (qTextEl) {
          result.questionTextElement = qTextEl;
          result.questionText = qTextEl.innerText.trim();
      }

      // Categories (bên trái): button.objectMatching-category-item
      const catBtns = root.querySelectorAll('button.objectMatching-category-item');
      catBtns.forEach(btn => {
          const textEl = btn.querySelector('.category-item-text');
          if (textEl) {
              const text = textEl.innerText.replace(/<!--.*?-->/g, '').trim();
              if (text) result.categories.push(text);
          }
      });

      // Options (bên phải): button.objectMatching-option-item
      const optBtns = root.querySelectorAll('button.objectMatching-option-item');
      optBtns.forEach(btn => {
          const inner = btn.querySelector('.objectMatching-option-item-inner') || btn;
          const text = inner.innerText.replace(/<!--.*?-->/g, '').replace(/^[A-Z]\s+/, '').trim();
          if (text) result.options.push(text);
      });

      result.viewElementForClick = viewElement; // lưu ref để click sau

      // Đánh dấu đã xử lý để tránh chạy lại khi DOM thay đổi
      if (viewElement._netacadProcessed) {
          result._alreadyProcessed = true;
      }
      viewElement._netacadProcessed = true;

      return result;
  }

  // 1. KIỂM TRA DẠNG DROPDOWN
  const isDropdownMatching = root.querySelectorAll('.dropdown__btn').length > 0;
  
  if (isDropdownMatching) {
      result.isMatching = true;
      result.isDropdown = true;
      result.targetElements = root.querySelectorAll('.matching__item-title_inner');
      result.targetElements.forEach(el => {
          let text = el.innerText.replace(/<!\-\-.*?\-\->/g, '').trim();          
          if (text) result.categories.push(text);
      });

      const firstBtn = root.querySelector('.dropdown__btn');
      if (firstBtn) {
          firstBtn.click(); 
          await new Promise(r => setTimeout(r, 100)); 
          
          document.querySelectorAll('.dropdown__item-inner').forEach(el => {
              let text = el.innerText.replace(/<!\-\-.*?\-\->/g, '').trim();              
              if (text) result.options.push(text);
          });
          result.options = [...new Set(result.options)]; 
          
          try { firstBtn.click(); } catch(e){} 
          await new Promise(r => setTimeout(r, 50));
      }
  } 
  // 2. KIỂM TRA DẠNG LINE MATCHING (objectMatching - nối đường A-B-C)
  else if (root.querySelectorAll('.objectMatching-category-item').length > 0) {
      result.isMatching = true;
      result.isLineMatching = true;

      // Categories bên trái: button.objectMatching-category-item
      const catBtns = root.querySelectorAll('.objectMatching-category-item');
      catBtns.forEach(btn => {
          const textEl = btn.querySelector('.category-item-text');
          const labelEl = btn.querySelector('.category-item-number');
          if (textEl) {
              const text = textEl.innerText.replace(/<!--.*?-->/g, '').trim();
              const label = labelEl ? labelEl.innerText.trim() : '';
              if (text) result.categories.push(text);
          }
      });

      // Options bên phải: button.objectMatching-option-item
      const optBtns = root.querySelectorAll('button.objectMatching-option-item');
      optBtns.forEach(btn => {
          // Text nằm trực tiếp trong button, lọc bỏ label A/B/C ở đầu nếu có
          const inner = btn.querySelector('.objectMatching-option-item-inner') || btn;
          let text = inner.innerText.replace(/<!--.*?-->/g, '').trim();
          // Bỏ prefix "A " / "B " nếu option bị gán label
          text = text.replace(/^[A-Z]\s+/, '').trim();
          if (text) result.options.push(text);
      });

      // Lưu lại elements để engine click sau này
      result.categoryButtons = catBtns;
      result.optionButtons = Array.from(optBtns);
  }
  // 3. KIỂM TRA DẠNG DRAG & DROP
  else if (root.querySelector('matching-view, .drag-drop-container') || root.querySelectorAll('[draggable="true"]').length > 0) {
      result.isMatching = true;
      result.targetElements = root.querySelectorAll('.drop-target, .category-box, [droppable]');
      result.sourceElements = root.querySelectorAll('.drag-item, [draggable="true"]');
      
      result.targetElements.forEach(el => result.categories.push(el.innerText.trim()));
      result.sourceElements.forEach(el => result.options.push(el.innerText.trim()));
  } 
  // 3. DẠNG TRẮC NGHIỆM BÌNH THƯỜNG (MCQ)
  else {
      // ── DẠNG REVIEW (đã nộp bài, xem lại đáp án) ──────────────
      // mcq__widget lúc này có thêm class is-submitted / show-correct-answer
      // và đáp án đúng được đánh dấu sẵn bằng class is-correct trên
      // .mcq__item — không cần gọi AI, chỉ cần đọc trực tiếp.
      const reviewWidget =
        (root.classList && (root.classList.contains("is-submitted") || root.classList.contains("show-correct-answer")))
          ? root
          : (root.querySelector ? root.querySelector(".mcq__widget.is-submitted, .mcq__widget.show-correct-answer, .component__widget.is-submitted") : null);

      if (reviewWidget) {
        result.isReview = true;
        const correctEls = reviewWidget.querySelectorAll(".mcq__item.is-correct .mcq__item-text-inner");
        correctEls.forEach(el => {
          const txt = el.innerText.replace(/\s+/g, " ").trim();
          if (txt) result.reviewAnswerTexts.push(txt);
        });
        result.reviewAnswerTexts = [...new Set(result.reviewAnswerTexts)];
        return result;
      }

      let aEls = root.querySelectorAll(".mcq__item-label, label");
      if (aEls.length === 0) {
         const baseView = root.querySelector('base-view[type="component"]');
         if (baseView?.shadowRoot) aEls = baseView.shadowRoot.querySelectorAll(".mcq__item-label, label");
      }
      result.answerElements = aEls;
      aEls.forEach(el => {
         let txt = el.innerText.replace(/Option\s*\d*\s*of\s*\d*/gi, "").replace(/\b\d+\s+of\s+\d+\b/gi, "").trim();
         if(txt) result.answerTexts.push(txt);
      });
      result.answerTexts = [...new Set(result.answerTexts)];
  }
  
  return result;
}

async function scrapeData() {
  if (window._isScrapingActive) return false;
  window._isScrapingActive = true;

  try {
      const storedData = await chrome.storage.sync.get(["geminiApiKey"]);
      if (!storedData.geminiApiKey) { window._isScrapingActive = false; return false; }

      let viewElements = [];
      let allQuestionsData = [];

      // Dùng walkShadow dùng chung từ utils.js thay vì viết lại logic đệ quy
      const { walkShadow, safeQueryAll } = window.NetacadUtils || {};

      for (let attempt = 1; attempt <= 20; attempt++) {
        viewElements = [];
        const appRoot = document.querySelector("app-root");
        if (appRoot && appRoot.shadowRoot && walkShadow) {
          const dropdownGroups = []; // [{ root, items: [matching-dropdown-view,...] }]
          walkShadow(appRoot.shadowRoot, root => {
            safeQueryAll(root, "mcq-view, matching-view, dnd-view").forEach(m => {
              if (!viewElements.includes(m)) viewElements.push(m);
            });
            // Tìm objectMatching widget (dạng Line Matching)
            safeQueryAll(root, '[class*="objectMatching__widget"], .component__widget.objectMatching__widget').forEach(w => {
              if (!viewElements.includes(w)) viewElements.push(w);
            });
            // Dạng MỚI: matching-dropdown-view — mỗi dòng/cặp là 1 custom element
            // riêng có shadowRoot riêng, nên KHÔNG gộp vào selector chung ở trên.
            // Các dòng cùng 1 câu hỏi thường là anh em (siblings) nằm trong cùng 1 "root"
            // (cùng 1 shadowRoot/document cha) → gom theo root để tạo thành 1 câu hỏi.
            const ddItems = safeQueryAll(root, "matching-dropdown-view");
            if (ddItems.length > 0) {
              let group = dropdownGroups.find(g => g.root === root);
              if (!group) { group = { root, items: [] }; dropdownGroups.push(group); }
              ddItems.forEach(it => { if (!group.items.includes(it)) group.items.push(it); });
            }
          });

          // Mỗi group (1 root chứa N matching-dropdown-view) = 1 "view" giả,
          // đại diện cho 1 câu hỏi matching dạng dropdown mới.
          dropdownGroups.forEach(g => {
            g._isDropdownGroupRoot = true;
            if (!viewElements.includes(g)) viewElements.push(g);
          });
        }

        if (viewElements.length > 0) {
             for (const [index, view] of viewElements.entries()) {
               // Câu hỏi này đã được xử lý xong rồi (đã có khung đáp án) → bỏ qua
               // hoàn toàn. Quan trọng với các trang thi dài có NHIỀU câu hỏi cùng
               // tồn tại trong DOM 1 lúc: không được coi câu ĐÃ xử lý là "câu mới"
               // chỉ vì có 1 câu khác trên trang vừa thay đổi.
               // NGOẠI LỆ: NetAcad là SPA, cùng 1 node có thể chuyển từ "đang làm"
               // sang "đã nộp bài / review" mà KHÔNG reload trang → vẫn phải quét
               // lại 1 lần nữa cho trạng thái review (đáp án đúng có sẵn).
               if (view && !view._isDropdownGroupRoot && view._netacadFullyProcessed) {
                 const probeRoot = view.shadowRoot || view;
                 const looksLikeReviewNow = !!(probeRoot && probeRoot.querySelector &&
                   probeRoot.querySelector(".is-submitted, .show-correct-answer"));
                 if (!looksLikeReviewNow || view._netacadReviewProcessed) continue;
               }

               const ext = await extractQuestionAndAnswers(view, index);
               if (ext._alreadyProcessed) continue; // bỏ qua nếu đã xử lý rồi (dropdown-group / objectMatching tự quản lý cờ riêng)

               // ── REVIEW (đã nộp bài) — đáp án đúng có sẵn, KHÔNG gọi AI ──
               if (ext.isReview) {
                 if (window.ensureQuestionBox) window.ensureQuestionBox(ext, index);
                 if (window.renderReviewAnswer && ext._uiBox) window.renderReviewAnswer(ext._uiBox, ext);
                 if (view && !view._isDropdownGroupRoot) {
                   view._netacadFullyProcessed = true;
                   view._netacadReviewProcessed = true;
                 }
                 continue;
               }

               if (ext.answerTexts.length > 0 || ext.isMatching) {
                 // Hiện khung "📋 Copy câu hỏi" NGAY khi vừa scrape xong,
                 // TRƯỚC khi gọi AI (đồng bộ, không chờ batch/matching API).
                 // qData._uiBox được set lên `ext` ở đây nên khi spread vào
                 // object bên dưới, `q._uiBox` sẽ được giữ lại — các lần gọi
                 // processSingleQuestion sau đó chỉ cập nhật nội dung trong
                 // box này, không tạo khung mới.
                 if (window.ensureQuestionBox) window.ensureQuestionBox(ext, index);
                 allQuestionsData.push({ ...ext, viewElement: view, originalIndex: index });
                 if (view && !view._isDropdownGroupRoot) view._netacadFullyProcessed = true;
               }
             }
             if (allQuestionsData.length > 0) break;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      if (allQuestionsData.length === 0) { window._isScrapingActive = false; return false; }

      let mcqBatch = [];
      for (const q of allQuestionsData) {
        if (q.isMatching) {
          await processSingleQuestion(q.viewElement, q.originalIndex, storedData.geminiApiKey, null, true, q);
        } else {
          // FIX LỖI ẨN UI: Khởi tạo giao diện Loading ngay lập tức trước khi gọi Batch API
          await processSingleQuestion(q.viewElement, q.originalIndex, storedData.geminiApiKey, "BATCH_PROCESSING_STARTED", false, q);
          mcqBatch.push({ question: q.questionText, answers: q.answerTexts, qData: q });
        }
      }

      if (mcqBatch.length > 0) {
        const batchRes = await getAiAnswersForBatch(mcqBatch, storedData.geminiApiKey);
        for (let i = 0; i < mcqBatch.length; i++) {
          const q = mcqBatch[i].qData;
          const finalAns = batchRes.error ? batchRes.error : (batchRes.answers[i] || "Lỗi AI.");
          await processSingleQuestion(q.viewElement, q.originalIndex, storedData.geminiApiKey, finalAns, false, q);
        }
      }
      
      window._isScrapingActive = false;
      return true;

  } catch (err) {
      window._isScrapingActive = false;
      return false;
  }
}