function parseAiAnswers(rawText) {
  if (!rawText) return [];
  const chunks = rawText.split(/ \/\/\/ |[\n\r]+/);
  return chunks.map(ans => ans.trim().replace(/\*\*|\*/g, "").replace(/^[-*•❑■▀✅=>]+\s*/, "").replace(/^([a-zA-Z]|\d{1,2})[.)\]]\s+/, "").replace(/^(option\s*)?\d*\s*of\s*\d*$/gi, "").trim()).filter(ans => ans.length > 0);
}

const normalize = (str) => {
  if (!str) return "";
  let s = str.toLowerCase().replace(/\s+/g, ' ').trim();
  return s.replace(/^([a-z]|\d{1,2})[.)\]]\s+/, "").replace(/option\s*\d*\s*of\s*\d*/gi, "").replace(/\b\d+\s+of\s+\d+\b/gi, "").replace(/[.,;:'"“”‘’\[\]{}()]/g, "").trim();
};

function dispatchClick(el) {
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  });
}

function clickInputForLabel(labelEl) {
  const forId = labelEl.getAttribute && labelEl.getAttribute("for");

  // Strategy 1: Tìm input.mcq__item-input cùng shadow root với label (NetAcad pattern)
  try {
    const root = labelEl.getRootNode();
    if (forId && root) {
      // querySelector bằng id trong cùng shadow root
      const inp = root.querySelector('#' + CSS.escape(forId));
      if (inp) {
        dispatchClick(inp);
        if (!inp.checked) {
          inp.checked = true;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
    }
  } catch(e) {}

  // Strategy 2: Tìm input trong cùng .mcq__item (sibling của label)
  try {
    const mcqItem = labelEl.closest('.mcq__item');
    if (mcqItem) {
      const inp = mcqItem.querySelector('input.mcq__item-input, input[type="checkbox"], input[type="radio"]');
      if (inp) {
        dispatchClick(inp);
        if (!inp.checked) {
          inp.checked = true;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
    }
  } catch(e) {}

  // Strategy 3: Click trực tiếp label với full mouse events
  try { dispatchClick(labelEl); } catch(e) {}

  // Strategy 4: Walk toàn bộ shadow DOM tìm input theo id
  if (forId) {
    try {
      function findInShadow(root, id) {
        if (!root) return null;
        const el = root.querySelector('#' + CSS.escape(id));
        if (el) return el;
        for (const child of root.querySelectorAll('*')) {
          if (child.shadowRoot) {
            const found = findInShadow(child.shadowRoot, id);
            if (found) return found;
          }
        }
        return null;
      }
      const inp = findInShadow(document, forId);
      if (inp) {
        dispatchClick(inp);
        if (!inp.checked) {
          inp.checked = true;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch(e) {}
  }
}

function autoSelectAnswers(answerElements, aiAnswerTexts, index) {
  if (!answerElements || answerElements.length === 0 || !aiAnswerTexts || aiAnswerTexts.length === 0) return 0;
  const normalizedAiAnswers = aiAnswerTexts.map(normalize);
  let clickedCount = 0;
  const clickedTexts = new Set();

  answerElements.forEach((labelEl) => {
    const rawText = labelEl.innerText || labelEl.textContent || '';
    const labelText = normalize(rawText);
    if (!labelText) return;

    const isMatch = normalizedAiAnswers.some(aiAns => {
      const cleanAiAns = aiAns.replace(/[.,;:'""''\[\]{}()]/g, "");
      return labelText === cleanAiAns || 
             (labelText.length > 3 && cleanAiAns.includes(labelText)) || 
             (cleanAiAns.length > 3 && labelText.includes(cleanAiAns));
    });

    if (isMatch && !clickedTexts.has(labelText)) {
      clickInputForLabel(labelEl);
      clickedTexts.add(labelText);
      clickedCount++;
    }
  });

  // Verify & retry: nếu input vẫn chưa checked, thử lại lần 2
  answerElements.forEach((labelEl) => {
    const rawText = labelEl.innerText || labelEl.textContent || '';
    const labelText = normalize(rawText);
    if (!clickedTexts.has(labelText)) return;
    try {
      const container = labelEl.closest('.mcq__item, .mcq__option, .option, [class*="item"]') || labelEl.parentElement;
      const inp = container && container.querySelector('input[type="radio"], input[type="checkbox"]');
      if (inp && !inp.checked) {
        inp.click(); // retry
      }
    } catch(e) {}
  });

  return clickedCount;
}


// ==========================================
// ENGINE 1: DRAG & DROP
// ==========================================
function simulateDragAndDrop(sourceNode, targetNode) {
  const dataTransfer = new DataTransfer();
  ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend'].forEach(type => {
    const node = (type === 'dragstart' || type === 'dragend') ? sourceNode : targetNode;
    node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  });
}

function autoMatchDragDrop(sourceElements, targetElements, aiMappingJSON) {
  let matchCount = 0;
  try {
    const mapping = JSON.parse(aiMappingJSON.replace(/```json/gi, "").replace(/```/g, ""));
    Object.keys(mapping).forEach(categoryKey => {
      const targetObj = Array.from(targetElements).find(el => normalize(el.innerText || "").includes(normalize(categoryKey)));
      const sourceObj = Array.from(sourceElements).find(el => normalize(el.innerText || "").includes(normalize(mapping[categoryKey])));
      if (targetObj && sourceObj) { simulateDragAndDrop(sourceObj, targetObj); matchCount++; }
    });
  } catch (e) {}
  return matchCount;
}

// ==========================================
// ENGINE 3: LINE MATCHING (objectMatching - Click nối A-B-C)
// ==========================================
async function autoMatchLinePairs(aiMappingJSON, viewElement) {
  let matchCount = 0;
  try {
    const mapping = JSON.parse(aiMappingJSON.replace(/```json/gi, "").replace(/```/g, "").trim());
    // objectMatching là div thường (không có shadowRoot) — dùng element trực tiếp
    const root = viewElement.shadowRoot || viewElement;
    if (!root) return 0;

    // Lấy tất cả category buttons (bên trái)
    const catBtns = Array.from(root.querySelectorAll('button.objectMatching-category-item'));
    // Lấy tất cả option buttons (bên phải)
    const optBtns = Array.from(root.querySelectorAll('button.objectMatching-option-item'));
    
    console.log(`[NetAcad] objectMatching: ${catBtns.length} cat buttons, ${optBtns.length} opt buttons`);

    console.log(`[NetAcad] Line Matching: ${catBtns.length} categories, ${optBtns.length} options`);

    // Helper: lấy text thuần từ button (bỏ label A/B/C prefix nếu có)
    function getBtnText(btn) {
      const inner = btn.querySelector('.objectMatching-category-item-inner, .objectMatching-option-item-inner') || btn;
      // Lấy text từ .category-item-text nếu có, không thì dùng toàn bộ innerText
      const textEl = inner.querySelector('.category-item-text') || inner;
      return normalize((textEl.innerText || '').replace(/^[A-Z]\s+/, '').trim());
    }

    for (const [catKey, optVal] of Object.entries(mapping)) {
      const normKey = normalize(catKey);
      const normVal = normalize(optVal).replace(/^[a-z]\s+/, '').trim();

      // Tìm category button: khớp theo .category-item-text
      const catBtn = catBtns.find(btn => {
        const textEl = btn.querySelector('.category-item-text') || btn;
        const text = normalize(textEl.innerText || '');
        return text === normKey || 
               text.includes(normKey.substring(0, 25)) || 
               normKey.includes(text.substring(0, 25));
      });

      // Tìm option button: text nằm thẳng trong button
      const optBtn = optBtns.find(btn => {
        const text = getBtnText(btn);
        return text === normVal || 
               text.includes(normVal) || 
               normVal.includes(text);
      });

      if (catBtn && optBtn) {
        // Click category first, wait for widget state, then click option
        catBtn.click();
        // Wait for widget to enter "selection mode" — poll until catBtn has active/selected class
        await new Promise(r => {
          let tries = 0;
          const poll = () => {
            const isActive = catBtn.classList.contains('is-active') || 
                             catBtn.classList.contains('selected') || 
                             catBtn.getAttribute('aria-pressed') === 'true' ||
                             catBtn.getAttribute('aria-selected') === 'true';
            if (isActive || tries++ > 20) { r(); return; }
            setTimeout(poll, 50);
          };
          poll();
        });
        // Fallback: ensure at least 150ms passed
        await new Promise(r => setTimeout(r, 150));
        optBtn.click();
        await new Promise(r => setTimeout(r, 300));
        matchCount++;
        console.log(`[NetAcad] ✅ Matched: "${catKey}" → "${optVal}"`);
      } else {
        console.warn(`[NetAcad] ❌ No match: cat="${catKey}"(${!!catBtn}) opt="${optVal}"(${!!optBtn})`);
        console.log('Available cats:', catBtns.map(b => (b.querySelector('.category-item-text')||b).innerText.trim()));
        console.log('Available opts:', optBtns.map(b => getBtnText(b)));
      }
    }
  } catch(e) {
    console.error("[NetAcad] Line Matching error:", e);
  }
  return matchCount;
}


// ==========================================
// ENGINE 2: DROPDOWN
// ==========================================
async function autoMatchDropdowns(aiMappingJSON, viewElement) {
  let matchCount = 0;
  try {
    const mapping = JSON.parse(aiMappingJSON.replace(/```json/gi, "").replace(/```/g, ""));
    const keys = Object.keys(mapping);
    const root = viewElement.shadowRoot;
    
    const allCats = Array.from(root.querySelectorAll('.matching__item-title_inner'));
    const allBtns = Array.from(root.querySelectorAll('.dropdown__btn'));

    for (const categoryKey of keys) {
      const optionValue = mapping[categoryKey];
      const catIndex = allCats.findIndex(el => normalize(el.innerText).includes(normalize(categoryKey)) || normalize(categoryKey).includes(normalize(el.innerText)));
      
      if (catIndex !== -1 && allBtns[catIndex]) {
        const targetBtn = allBtns[catIndex];
        targetBtn.click();
        await new Promise(r => setTimeout(r, 150)); 

        const options = Array.from(document.querySelectorAll('.dropdown__item-inner'));
        const optEl = options.find(el => normalize(el.innerText).includes(normalize(optionValue)) || normalize(optionValue).includes(normalize(el.innerText)));
        
        if (optEl) {
          optEl.click();
          matchCount++;
        } else {
          try { targetBtn.click(); } catch(e){} 
        }
        await new Promise(r => setTimeout(r, 150)); 
      }
    }
  } catch (e) {
    console.error("Lỗi Auto Dropdown:", e);
  }
  return matchCount;
}

// ==========================================
// UI COMPONENTS (Đã bọc chung Wrapper chống mất nút Copy)
// ==========================================
function createAiAssistantUI(uiContainerId, copyBtnId) {
  // 1. Vỏ bọc tổng (Wrapper) chứa cả Copy Button và AI Box
  const wrapper = document.createElement("div");
  wrapper.id = uiContainerId;
  wrapper.className = "netacad-ai-assistant-ui"; 
  wrapper.style.cssText = "margin-top:16px; display:flex; flex-direction:column; gap:12px;";

  // 2. Nút Copy (Nằm độc lập bên trên)
  const copyButton = document.createElement("button");
  copyButton.id = copyBtnId;
  copyButton.textContent = "📋 Sao chép Q&A";
  copyButton.style.cssText = "align-self: flex-start; padding:8px 16px; border:1px solid #cbd5e1; border-radius:6px; background:#ffffff; color:#475569; font-size:13px; font-weight:600; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.05); transition:all 0.2s ease;";
  copyButton.onmouseover = () => { copyButton.style.background = "#f1f5f9"; };
  copyButton.onmouseout = () => { copyButton.style.background = "#ffffff"; };

  // 3. Khung AI (Nằm bên dưới)
  const aiBox = document.createElement("div");
  aiBox.style.cssText = "padding:16px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc;";
  
  const titleElement = document.createElement("h5");
  titleElement.innerHTML = "✨ Gemini AI Suggestion";
  titleElement.style.cssText = "margin:0 0 8px 0; color:#3b82f6; font-size:14px;";
  aiBox.appendChild(titleElement);

  const aiAnswerDisplay = document.createElement("p");
  aiAnswerDisplay.style.cssText = "margin:8px 0; font-size:14px; color:#1e293b;";
  aiAnswerDisplay.textContent = "Đang phân tích dữ liệu...";
  aiBox.appendChild(aiAnswerDisplay);

  const refreshButton = document.createElement("button");
  refreshButton.textContent = "Thử hỏi lại AI";
  refreshButton.style.cssText = "padding:6px 14px; border-radius:6px; border:none; cursor:pointer; background:#e2e8f0; color:#475569; margin-top:8px;";
  aiBox.appendChild(refreshButton);

  wrapper.appendChild(copyButton);
  wrapper.appendChild(aiBox);

  return { wrapper, copyButton, aiAnswerDisplay, refreshButton };
}

// ==========================================
// XỬ LÝ CHÍNH
// ==========================================
async function processSingleQuestion(viewElement, index, apiKey, preFetchedAiAnswer = null, isMatching = false, extractedData = null) {
  const uiContainerId = `netacad-ai-q-${index}`;
  const copyBtnId = `netacad-copy-btn-${index}`;
  
  const data = extractedData || await extractQuestionAndAnswers(viewElement, index);
  if (!data) return;

  // FIX: Nếu UI đã tồn tại và chỉ cần cập nhật kết quả batch, update in-place
  const existingWrapper = document.getElementById(uiContainerId);
  if (existingWrapper && preFetchedAiAnswer && preFetchedAiAnswer !== "BATCH_PROCESSING_STARTED") {
    const existingDisplay = existingWrapper.querySelector('p');
    if (existingDisplay) {
      if (!isMatching && !data.isMatching) {
        const parsed = parseAiAnswers(preFetchedAiAnswer);
        autoSelectAnswers(data.answerElements, parsed, index);
        existingDisplay.innerHTML = `✅ Đã chọn AI:<br/>- ` + parsed.join("<br/>- ");
      }
      return;
    }
  }

  // Dọn dẹp DOM cũ an toàn
  if (existingWrapper) existingWrapper.remove();
  if (viewElement?.shadowRoot) {
    const oldUi = viewElement.shadowRoot.querySelector(`#${uiContainerId}`);
    if (oldUi) oldUi.remove();
  }
  if (data.questionTextElement && data.questionTextElement.parentNode) {
    const oldOutUi = data.questionTextElement.parentNode.querySelector(`#${uiContainerId}`);
    if (oldOutUi) oldOutUi.remove();
  }

  const { wrapper, copyButton, aiAnswerDisplay, refreshButton } = createAiAssistantUI(uiContainerId, copyBtnId);
  
  // Chèn Wrapper chứa cả 2 vào web
  if (data.questionTextElement && data.questionTextElement.parentNode) {
    data.questionTextElement.parentNode.insertBefore(wrapper, data.questionTextElement.nextSibling);
  } else if (viewElement?.shadowRoot) {
    viewElement.shadowRoot.appendChild(wrapper);
  }

  // Logic sao chép Q&A
  copyButton.addEventListener("click", () => {
    let textToCopy = data.questionText + "\n\n";
    
    if (isMatching || data.isMatching) {
      if (data.categories && data.categories.length > 0) {
        textToCopy += "Categories:\n";
        data.categories.forEach((c, i) => textToCopy += `${i+1}. ${c}\n`);
        textToCopy += "\nOptions:\n";
        data.options.forEach((o, i) => textToCopy += `- ${o}\n`);
      }
    } else {
      if (data.answerTexts && data.answerTexts.length > 0) {
        data.answerTexts.forEach((ans, i) => textToCopy += `${i + 1}. ${ans}\n`);
      } else {
        textToCopy += "(Không tìm thấy danh sách lựa chọn để copy)\n";
      }
    }

    navigator.clipboard.writeText(textToCopy.trim()).then(() => {
      const oldText = copyButton.textContent;
      copyButton.textContent = "✓ Đã chép Q&A!";
      copyButton.style.background = "#10b981";
      copyButton.style.color = "white";
      copyButton.style.borderColor = "#10b981";
      setTimeout(() => {
        copyButton.textContent = oldText;
        copyButton.style.background = "#ffffff";
        copyButton.style.color = "#475569";
        copyButton.style.borderColor = "#cbd5e1";
      }, 1200);
    });
  });

  const handleAction = async () => {
    aiAnswerDisplay.textContent = "Đang hỏi AI...";
    const imageUrls = data.questionImages || [];
    const rawRes = await getAiAnswer(data.questionText, (isMatching || data.isMatching) ? { categories: data.categories, options: data.options } : data.answerTexts, apiKey, (isMatching || data.isMatching), imageUrls);
    
    if (rawRes.toLowerCase().startsWith("error") || rawRes.toLowerCase().startsWith("lỗi")) {
      aiAnswerDisplay.textContent = rawRes;
      return;
    }

    if (isMatching || data.isMatching) {
      let clicks = 0;
      if (data.isDropdown) {
         clicks = await autoMatchDropdowns(rawRes, viewElement);
      } else if (data.isLineMatching) {
         clicks = await autoMatchLinePairs(rawRes, viewElement);
      } else {
         clicks = autoMatchDragDrop(data.sourceElements, data.targetElements, rawRes);
      }
      const neatJson = rawRes.replace(/```json|```/gi, "").trim();
      aiAnswerDisplay.innerHTML = `✅ Đã chọn/nối tự động (${clicks} cặp) <br/><pre style="font-size:12px; margin-top:8px; background:#e2e8f0; padding:8px; border-radius:6px; white-space: pre-wrap; font-family: monospace;">${neatJson}</pre>`;
    } else {
      const parsed = parseAiAnswers(rawRes);
      const clicks = autoSelectAnswers(data.answerElements, parsed, index);
      aiAnswerDisplay.innerHTML = `✅ Đã tự động chọn (${clicks}):<br/>- ` + parsed.join("<br/>- ");
    }
  };

  refreshButton.addEventListener("click", handleAction);

  if (!preFetchedAiAnswer) {
    await handleAction();
  } else {
    if (!isMatching && !data.isMatching && !preFetchedAiAnswer.includes("BATCH")) {
       const parsed = parseAiAnswers(preFetchedAiAnswer);
       autoSelectAnswers(data.answerElements, parsed, index);
       aiAnswerDisplay.innerHTML = `✅ Đã chọn AI:<br/>- ` + parsed.join("<br/>- ");
    } else if (preFetchedAiAnswer === "BATCH_PROCESSING_STARTED") {
       aiAnswerDisplay.textContent = "Đang gửi câu hỏi cho AI, vui lòng đợi...";
    }
  }
}