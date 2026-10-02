(function() {
  const DIALECT_CONTEXT_MESSAGES = 10;
  const translationCache = new Map();
  const settings = { manualDialectOverride: "" };
  function applyStoredSettings(stored) {
    if (stored.manualDialectOverride !== void 0) settings.manualDialectOverride = stored.manualDialectOverride || "";
  }
  chrome.storage.local.get(["manualDialectOverride"], applyStoredSettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.manualDialectOverride) applyStoredSettings({ manualDialectOverride: changes.manualDialectOverride.newValue });
  });
  function detectDirection(selectedText) {
    const cyrillic = (selectedText.match(/[Ѐ-ӿ]/g) || []).length;
    const letters = (selectedText.match(/\p{L}/gu) || []).length;
    if (letters === 0) return "to_dialect";
    return cyrillic / letters > 0.3 ? "to_dialect" : "to_operator_language";
  }
  function sendTranslateRequest(text, dialectContext, targetLang, direction) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "translate", payload: { text, dialectContext, targetLang, direction } },
        (response) => resolve(response || { ok: false, kind: "network_error" })
      );
    });
  }
  async function runTranslation(text, chatId, cacheKey) {
    window.CftTranslateBubble.showLoading();
    const direction = detectDirection(text);
    let dialectContext = [];
    if (chatId) {
      try {
        const messages = await window.CftChatterfyApi.fetchChatMessages(chatId);
        dialectContext = window.CftChatterfyApi.buildDialectContext(messages, DIALECT_CONTEXT_MESSAGES);
      } catch (err) {
        console.warn("[Chatterfy Translator] не удалось получить контекст диалекта:", err);
      }
    }
    const targetLang = direction === "to_dialect" ? settings.manualDialectOverride || void 0 : void 0;
    const response = await sendTranslateRequest(text, dialectContext, targetLang, direction);
    if (response.ok) {
      translationCache.set(cacheKey, response.translation);
      window.CftTranslateBubble.showSuccess(response.translation);
    } else if (response.kind === "budget_exceeded" || response.kind === "rate_limited") {
      window.CftTranslateBubble.showBudgetExceeded(response.message);
    } else {
      window.CftTranslateBubble.showNetworkError(() => runTranslation(text, chatId, cacheKey));
    }
  }
  function handleSelection(rect, text) {
    const chatId = window.CftChatterfyApi.getChatId();
    const cacheKey = `${chatId || "no-chat-id"}::${text}`;
    if (translationCache.has(cacheKey)) {
      window.CftTranslateBubble.showIdle(rect, () => {
      });
      window.CftTranslateBubble.showSuccess(translationCache.get(cacheKey));
      return;
    }
    window.CftTranslateBubble.showIdle(rect, () => runTranslation(text, chatId, cacheKey));
  }
  document.addEventListener("mouseup", (e) => {
    const container = window.CftChatterfyApi.getChatContainer();
    if (!container || !container.contains(e.target)) {
      return;
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text) {
      window.CftTranslateBubble.hide();
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    handleSelection(rect, text);
  });
})();
