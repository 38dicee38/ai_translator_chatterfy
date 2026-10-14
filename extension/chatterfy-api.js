(function() {
  const CONFIG = {
    chatContainerSelector: '[data-testid="chat-messages"], .chat-messages, .messages-list, main',
    chatIdFromUrlPattern: /\/chats?\/([a-zA-Z0-9-]+)/
  };
  const MESSAGES_SEARCH_URL = "https://migration-api.chatterfy.ai/api/messages/v1/search";
  const COMPOSE_EDITOR_SELECTOR = [
    '.ql-editor[contenteditable="true"]',
    '.composer-editor[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
  ].join(", ");
  const JWT_PATTERN = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
  function getChatContainer() {
    return document.querySelector(CONFIG.chatContainerSelector);
  }
  function getChatId() {
    const fromQuery = new URLSearchParams(location.search).get("chat");
    if (fromQuery) return fromQuery;
    const urlMatch = location.pathname.match(CONFIG.chatIdFromUrlPattern);
    if (urlMatch) return urlMatch[1];
    const el = document.querySelector("[data-chat-id]");
    if (el) return el.getAttribute("data-chat-id");
    return null;
  }
  function findJwtInStorage(storage) {
    for (let i = 0; i < storage.length; i++) {
      const value = storage.getItem(storage.key(i));
      if (typeof value !== "string") continue;
      const match = value.match(JWT_PATTERN);
      if (match) return match[0];
    }
    return null;
  }
  function getAuthToken() {
    try {
      return findJwtInStorage(window.localStorage) || findJwtInStorage(window.sessionStorage) || null;
    } catch (err) {
      return null;
    }
  }
  async function fetchChatMessages(chatId, limit) {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.authorization = token;
    const res = await fetch(MESSAGES_SEARCH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ chat_id: chatId, limit: limit || 50 })
    });
    if (!res.ok) {
      throw new Error(`messages/v1/search вернул ${res.status}${token ? "" : " (токен авторизации не найден в localStorage/sessionStorage)"}`);
    }
    const data = await res.json();
    return data?.data?.items || data?.items || data?.messages || (Array.isArray(data) ? data : []);
  }
  function buildDialectContext(messages, limitMessages) {
    return messages.filter((m) => m && m.sender_type === "incoming" && typeof m.content === "string" && m.content.trim()).slice(0, limitMessages || 10).reverse().map((m) => m.content);
  }
  function getComposeEditor() {
    return document.querySelector(COMPOSE_EDITOR_SELECTOR);
  }
  function insertIntoCompose(text, options) {
    const replaceAll = Boolean(options && options.replaceAll);
    const editor = getComposeEditor();
    if (!editor) return false;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    if (!replaceAll) range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand("insertText", false, text);
    if (!ok) {
      editor.textContent = replaceAll ? text : (editor.textContent || "") + text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return true;
  }
  window.CftChatterfyApi = {
    getChatContainer,
    getChatId,
    getAuthToken,
    fetchChatMessages,
    buildDialectContext,
    getComposeEditor,
    insertIntoCompose
  };
})();
