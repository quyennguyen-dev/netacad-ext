window._isScrapingActive = false;
window._lastScrapedSignature = "";

async function extractQuestionAndAnswers(viewElement, index) {
  let result = {
    isMatching: false,
    isDropdown: false,
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
      
      for (let attempt = 1; attempt <= 20; attempt++) {
        viewElements = [];
        const appRoot = document.querySelector("app-root");
        if (appRoot && appRoot.shadowRoot) {
          function walk(node) {
            if (!node || typeof node.querySelectorAll !== "function") return;
            const items = node.querySelectorAll("mcq-view, matching-view, dnd-view");
            items.forEach(m => viewElements.push(m));
            // Tìm objectMatching widget (dạng Line Matching)
            const objMatchWidgets = node.querySelectorAll('[class*="objectMatching__widget"], .component__widget.objectMatching__widget');
            objMatchWidgets.forEach(w => {
              // Wrap lại thành pseudo view element để xử lý chung
              if (!viewElements.includes(w)) viewElements.push(w);
            });
            for (const el of node.querySelectorAll("*")) {
              if (el.shadowRoot) walk(el.shadowRoot);
            }
          }
          walk(appRoot.shadowRoot);
        }

        if (viewElements.length > 0) {
             for (const [index, view] of viewElements.entries()) {
               const ext = await extractQuestionAndAnswers(view, index);
               if (ext._alreadyProcessed) continue; // bỏ qua nếu đã xử lý rồi
               if (ext.answerTexts.length > 0 || ext.isMatching) {
                 allQuestionsData.push({ ...ext, viewElement: view, originalIndex: index });
               }
             }
             if (allQuestionsData.length > 0) break;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      if (allQuestionsData.length === 0) { window._isScrapingActive = false; return false; }

      const currentSignature = allQuestionsData.map(q => q.questionText.substring(0, 50)).join("||");
      if (window._lastScrapedSignature === currentSignature && document.querySelector('.netacad-ai-assistant-ui')) {
          window._isScrapingActive = false; return true;
      }
      window._lastScrapedSignature = currentSignature;

      document.querySelectorAll(".netacad-ai-assistant-ui").forEach(el => el.remove());
      // Reset processed flag khi sang câu mới
      document.querySelectorAll('[class*="objectMatching__widget"]').forEach(el => {
        el._netacadProcessed = false;
      });

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