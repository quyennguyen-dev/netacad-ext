// const DEFAULT_MODEL = "gemini-2.0-flash-lite";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

// Fetch ảnh và convert sang base64 để gửi lên Gemini Vision
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve({ base64, mimeType: blob.type || 'image/png' });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch(e) { return null; }
}

async function getApiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;
}

async function getAiAnswer(question, answers, apiKey, isMatching = false, imageUrls = []) {
  if (!apiKey) return "Error: Chưa nhập Gemini API Key trong tiện ích.";

  let prompt = "";
  
  if (isMatching) {
    // PROMPT CHO CÂU MATCHING (Dropdown / Drag-Drop / Line)
    prompt = `This is a matching question. Match each item in 'Categories' (left side - usually descriptions) to the correct item in 'Options' (right side - usually short labels/names).
Return ONLY a valid JSON object with NO markdown code blocks. 
Keys = exact text from Categories. Values = exact text from Options.
Example format: {"Category text A": "Option text 1", "Category text B": "Option text 2"}

Question: ${question}

Categories (left/descriptions):
${answers.categories.join("\n")}

Options (right/labels):
${answers.options.join("\n")}`;
  } else {
    // PROMPT CHO CÂU TRẮC NGHIỆM (MCQ)
    prompt = `Given the following multiple-choice question and its possible answers, please choose the best answer(s).
If the question implies multiple correct answers, return ALL chosen answer texts, each on a new line.
Otherwise, return only the text of the single best chosen answer option.
CRITICAL: Do not add any option numbers, letters, or bullets. Just return the raw text of the choices.
Question: ${question}

Possible Answers:
`;
    answers.forEach((ans, i) => { prompt += `${i + 1}. ${ans}\n`; });
  }

  try {
    const API_URL = await getApiUrl();

    // Build parts: text + images nếu có
    const parts = [];

    // Fetch và đính kèm images (tối đa 2 ảnh để tránh timeout)
    if (imageUrls && imageUrls.length > 0) {
      const imgFetches = imageUrls.slice(0, 2).map(url => fetchImageAsBase64(url));
      const imgResults = await Promise.all(imgFetches);
      imgResults.forEach(img => {
        if (img) {
          parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
        }
      });
    }

    parts.push({ text: prompt });

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    if (!response.ok) {
      return `Error: API trả về mã ${response.status}.`;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Error: Lỗi cấu trúc phản hồi từ AI.";
  } catch (error) {
    return "Error: Lỗi kết nối tới Gemini API. Vui lòng kiểm tra mạng.";
  }
}

// Giữ nguyên hàm getAiAnswersForBatch hiện tại của bạn cho các câu trắc nghiệm
async function getAiAnswersForBatch(questionsDataArray, apiKey) {
  if (!apiKey) return { error: "Error: Chưa thiết lập API Key." };
  if (!questionsDataArray || questionsDataArray.length === 0) return { answers: [] };

  let prompt = "You will be provided with a JSON array of multiple-choice questions. For each question, choose the best answer(s) from its 'Possible Answers'.\n" +
    "If a question implies multiple correct answers, include all correct answer texts for that question concatenated into a single string, separated by ' /// '.\n" +
    "Otherwise, return just the single best answer text.\n" +
    "CRITICAL: Do not add any list prefixes. Return the exact option text.\n" +
    "Return a strict JSON array of strings mapping 1:1 to the questions. Do not wrap output in markdown code blocks.";

  const questionsForPrompt = questionsDataArray.map((q, index) => ({
    id: `q_${index + 1}`, question_text: q.question, possible_answers: q.answers
  }));

  prompt += "\n\nInput Data:\n" + JSON.stringify(questionsForPrompt, null, 2);

  try {
    const API_URL = await getApiUrl();
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) return { error: `Error: Lỗi API Batch ${response.status}` };

    const data = await response.json();
    const rawResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    try {
      let cleanedText = rawResponseText.replace(/```json/gi, "").replace(/```/g, "").trim();
      let parsedAnswers = JSON.parse(cleanedText);
      
      if (!Array.isArray(parsedAnswers) && parsedAnswers && typeof parsedAnswers === "object") {
        if (Array.isArray(parsedAnswers.answers)) parsedAnswers = parsedAnswers.answers;
        else parsedAnswers = Object.values(parsedAnswers);
      }

      if (Array.isArray(parsedAnswers)) {
        const sanitizedAnswers = parsedAnswers.map(item => {
          if (Array.isArray(item)) return item.map(i => String(i).trim()).join(" /// ");
          if (item && typeof item === "object") return Object.values(item).map(i => String(i).trim()).join(" /// ");
          return String(item).trim();
        });

        if (sanitizedAnswers.length === questionsDataArray.length) return { answers: sanitizedAnswers };
        return { error: "Error: Mismatch count", answers: sanitizedAnswers };
      }
      return { error: "Error: Cấu trúc phản hồi không phải dạng Array." };
    } catch (e) {
      return { error: "Error: Không thể parse JSON từ AI." };
    }
  } catch (error) {
    return { error: "Error: Lỗi kết nối Batch API." };
  }
}