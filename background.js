chrome.commands.onCommand.addListener((command) => {
  if (command === "process-page-command") {
    console.log("Command received: process-page-command");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        const tabId = tabs[0].id;
        chrome.storage.sync.get(["showAnswers"], (result) => {
          let showAnswers = true;
          if (typeof result.showAnswers === "boolean") {
            showAnswers = result.showAnswers;
          }
          chrome.tabs.sendMessage(
            tabId,
            { action: "processPage", showAnswers: showAnswers },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error("Background Error:", chrome.runtime.lastError.message);
              } else {
                console.log("Background: Message sent, response:", response);
              }
            }
          );
        });
      } else {
        console.warn("Background: No active tab found.");
      }
    });
  }
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  // Trả về tabId của tab đang gửi (content.js dùng trước khi click open-dialog)
  if (req.action === "getTabId") {
    sendResponse({ tabId: sender.tab?.id ?? null });
    return false;
  }

  // Đóng tab mới mở ra từ open-dialog rồi focus lại tab gốc
  if (req.action === "closeNewTabAndFocus") {
    const originTabId = req.originTabId || sender.tab?.id;
    if (!originTabId) { sendResponse({ done: true }); return false; }

    chrome.tabs.get(originTabId, (originTab) => {
      if (chrome.runtime.lastError || !originTab) { sendResponse({ done: true }); return; }
      const windowId = originTab.windowId;

      chrome.tabs.query({ windowId }, (allTabs) => {
        // Tab mới hơn = id lớn hơn originTabId (Chrome tạo tab mới với id tăng dần)
        const toClose = allTabs
          .filter(t => t.id > originTabId)
          .map(t => t.id);

        const finish = () =>
          chrome.tabs.update(originTabId, { active: true }, () => sendResponse({ done: true }));

        if (toClose.length > 0) {
          chrome.tabs.remove(toClose, finish);
        } else {
          finish();
        }
      });
    });
    return true; // giữ sendResponse async
  }
});