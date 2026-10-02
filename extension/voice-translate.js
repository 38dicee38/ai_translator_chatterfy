(function() {
  const RESCAN_INTERVAL_MS = 2e3;
  const DIALECT_CONTEXT_MESSAGES = 10;
  function cacheKey(chatId, messageId) {
    return `cft-voice:${chatId}:${messageId}`;
  }
  async function getCached(chatId, messageId) {
    const key = cacheKey(chatId, messageId);
    const stored = await chrome.storage.local.get([key]);
    return stored[key] || null;
  }
  async function setCached(chatId, messageId, value) {
    await chrome.storage.local.set({ [cacheKey(chatId, messageId)]: value });
  }
  function transcribeRequest(url, durationSeconds) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "transcribe", payload: { url, durationSeconds } },
        (response) => resolve(response || { ok: false, kind: "network_error" })
      );
    });
  }
  function translateRequest(text, dialectContext) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "translate", payload: { text, dialectContext, direction: "to_operator_language" } },
        (response) => resolve(response || { ok: false, kind: "network_error" })
      );
    });
  }
  function clearPanel(panel) {
    panel.innerHTML = "";
    panel.classList.remove("cft-voice-panel--open", "cft-voice-panel--warn", "cft-voice-panel--error");
  }
  function renderIdle(panel, onClick) {
    clearPanel(panel);
    const btn = document.createElement("button");
    btn.className = "cft-voice-btn";
    btn.type = "button";
    btn.textContent = "Перевести";
    btn.addEventListener("click", onClick);
    panel.appendChild(btn);
  }
  function renderLoading(panel, label) {
    clearPanel(panel);
    panel.classList.add("cft-voice-panel--open");
    const row = document.createElement("div");
    row.className = "cft-voice-row";
    const spinner = document.createElement("div");
    spinner.className = "cft-voice-spinner";
    const text = document.createElement("div");
    text.textContent = label;
    row.appendChild(spinner);
    row.appendChild(text);
    panel.appendChild(row);
  }
  function renderResult(panel, transcript, translation, onClose) {
    clearPanel(panel);
    panel.classList.add("cft-voice-panel--open");
    const original = document.createElement("div");
    original.className = "cft-voice-block";
    original.innerHTML = '<div class="cft-voice-label">Оригинал (на диалекте):</div>';
    const originalText = document.createElement("div");
    originalText.className = "cft-voice-text";
    originalText.textContent = transcript;
    original.appendChild(originalText);
    const translated = document.createElement("div");
    translated.className = "cft-voice-block";
    translated.innerHTML = '<div class="cft-voice-label">Перевод:</div>';
    const translatedText = document.createElement("div");
    translatedText.className = "cft-voice-text";
    translatedText.textContent = translation;
    translated.appendChild(translatedText);
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-voice-btn cft-voice-btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Скрыть";
    closeBtn.addEventListener("click", onClose);
    panel.appendChild(original);
    panel.appendChild(translated);
    panel.appendChild(closeBtn);
  }
  function renderUnintelligible(panel, onClose) {
    clearPanel(panel);
    panel.classList.add("cft-voice-panel--open", "cft-voice-panel--warn");
    const text = document.createElement("div");
    text.className = "cft-voice-text";
    text.textContent = "Распознавание не дало разборчивого текста.";
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-voice-btn cft-voice-btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", onClose);
    panel.appendChild(text);
    panel.appendChild(closeBtn);
  }
  function renderBudgetExceeded(panel, message, onClose) {
    clearPanel(panel);
    panel.classList.add("cft-voice-panel--open", "cft-voice-panel--warn");
    const text = document.createElement("div");
    text.className = "cft-voice-text";
    text.textContent = message || "Дневной лимит бюджета исчерпан.";
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-voice-btn cft-voice-btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", onClose);
    panel.appendChild(text);
    panel.appendChild(closeBtn);
  }
  function renderError(panel, message, onRetry, onClose) {
    clearPanel(panel);
    panel.classList.add("cft-voice-panel--open", "cft-voice-panel--error");
    const text = document.createElement("div");
    text.className = "cft-voice-text";
    text.textContent = message;
    const row = document.createElement("div");
    row.className = "cft-voice-row";
    const retryBtn = document.createElement("button");
    retryBtn.className = "cft-voice-btn";
    retryBtn.type = "button";
    retryBtn.textContent = "Повторить";
    retryBtn.addEventListener("click", onRetry);
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-voice-btn cft-voice-btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", onClose);
    row.appendChild(retryBtn);
    row.appendChild(closeBtn);
    panel.appendChild(text);
    panel.appendChild(row);
  }
  async function dialectContextFor(chatId) {
    if (!chatId) return [];
    try {
      const messages = await window.CftChatterfyApi.fetchChatMessages(chatId);
      return window.CftChatterfyApi.buildDialectContext(messages, DIALECT_CONTEXT_MESSAGES);
    } catch (err) {
      console.warn("[Chatterfy Translator] не удалось получить контекст диалекта:", err);
      return [];
    }
  }
  function resetToIdle(panel, voice) {
    renderIdle(panel, () => runVoiceTranslation(voice, panel));
  }
  function handleFailure(response, panel, voice) {
    if (response.kind === "budget_exceeded" || response.kind === "rate_limited") {
      renderBudgetExceeded(panel, response.message, () => resetToIdle(panel, voice));
    } else {
      renderError(
        panel,
        "Не удалось выполнить запрос, попробуйте ещё раз",
        () => runVoiceTranslation(voice, panel),
        () => resetToIdle(panel, voice)
      );
    }
  }
  async function runVoiceTranslation(voice, panel) {
    let cached = await getCached(voice.chatId, voice.messageId);
    if (!cached) {
      renderLoading(panel, "Распознаю...");
      const transcribeResponse = await transcribeRequest(voice.url, voice.durationSeconds);
      if (!transcribeResponse.ok) {
        handleFailure(transcribeResponse, panel, voice);
        return;
      }
      cached = {
        transcript: transcribeResponse.transcript || "",
        translation: null,
        language: transcribeResponse.language || null,
        cachedAt: Date.now()
      };
      await setCached(voice.chatId, voice.messageId, cached);
    }
    if (!cached.transcript || !cached.transcript.trim()) {
      renderUnintelligible(panel, () => resetToIdle(panel, voice));
      return;
    }
    if (cached.translation) {
      renderResult(panel, cached.transcript, cached.translation, () => resetToIdle(panel, voice));
      return;
    }
    renderLoading(panel, "Перевожу...");
    const dialectContext = await dialectContextFor(voice.chatId);
    const translateResponse = await translateRequest(cached.transcript, dialectContext);
    if (!translateResponse.ok) {
      handleFailure(translateResponse, panel, voice);
      return;
    }
    cached.translation = translateResponse.translation;
    await setCached(voice.chatId, voice.messageId, cached);
    renderResult(panel, cached.transcript, cached.translation, () => resetToIdle(panel, voice));
  }
  const DURATION_TEXT_PATTERN = /^\d{1,2}:\d{2}\/(\d{1,2}:\d{2})$/;
  function formatDurationMMSS(totalSeconds) {
    const rounded = Math.round(totalSeconds);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  function formatTimeHHMM(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function findVoiceWidgets() {
    const widgets = [];
    document.querySelectorAll("div").forEach((el) => {
      if (el.children.length === 0 && DURATION_TEXT_PATTERN.test(el.textContent.trim())) {
        widgets.push(el);
      }
    });
    return widgets;
  }
  function findBubbleContainer(durationEl) {
    let node = durationEl;
    for (let i = 0; i < 20 && node; i += 1) {
      if (node.querySelector && node.querySelector("[data-message-timestamp]")) return node;
      node = node.parentElement;
    }
    return null;
  }
  function attachPanel(bubbleEl, voice) {
    const panel = document.createElement("div");
    panel.className = "cft-voice-panel";
    bubbleEl.appendChild(panel);
    bubbleEl.dataset.cftVoiceUrl = voice.url;
    resetToIdle(panel, voice);
  }
  async function scanForVoices() {
    const chatId = window.CftChatterfyApi.getChatId();
    if (!chatId) return;
    let messages;
    try {
      messages = await window.CftChatterfyApi.fetchChatMessages(chatId);
    } catch (err) {
      console.warn("[Chatterfy Translator] не удалось получить список сообщений для голосовых:", err);
      return;
    }
    const candidatesByKey = new Map();
    for (const m of messages) {
      if (m.sender_type !== "incoming") continue;
      for (const f of m.files || []) {
        if (f.type !== "voice" || !f.url) continue;
        const duration = f.meta && typeof f.meta.duration === "number" ? f.meta.duration : null;
        const timeText = formatTimeHHMM(m.created_at);
        if (duration === null || !timeText) continue;
        candidatesByKey.set(`${timeText}|${formatDurationMMSS(duration)}`, {
          chatId,
          messageId: m.id,
          url: f.url,
          durationSeconds: duration
        });
      }
    }
    const matchedBubbles = new Set();
    for (const widget of findVoiceWidgets()) {
      const match = DURATION_TEXT_PATTERN.exec(widget.textContent.trim());
      if (!match) continue;
      const bubble = findBubbleContainer(widget);
      if (!bubble) continue;
      const timestampEl = bubble.querySelector("[data-message-timestamp]");
      const widgetTimeText = timestampEl ? timestampEl.textContent.trim() : null;
      if (!widgetTimeText) continue;
      const candidate = candidatesByKey.get(`${widgetTimeText}|${match[1]}`);
      if (!candidate) continue;
      matchedBubbles.add(bubble);
      if (bubble.dataset.cftVoiceUrl === candidate.url) continue;
      const stalePanel = bubble.querySelector(":scope > .cft-voice-panel");
      if (stalePanel) stalePanel.remove();
      attachPanel(bubble, candidate);
    }
    document.querySelectorAll(".cft-voice-panel").forEach((panel) => {
      const bubble = panel.parentElement;
      if (bubble && !matchedBubbles.has(bubble)) {
        panel.remove();
        delete bubble.dataset.cftVoiceUrl;
      }
    });
  }
  setInterval(scanForVoices, RESCAN_INTERVAL_MS);
  scanForVoices();
})();
