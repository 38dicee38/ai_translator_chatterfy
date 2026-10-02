importScripts("shared-defaults.js");
async function getProxyConfig() {
  const stored = await chrome.storage.local.get(["proxyBaseUrl", "extensionToken"]);
  return {
    proxyBaseUrl: stored.proxyBaseUrl || CFT_DEFAULT_PROXY_BASE_URL,
    extensionToken: stored.extensionToken || CFT_DEFAULT_EXTENSION_TOKEN
  };
}
async function handleTranslate({ text, dialectContext, targetLang, direction }) {
  const { proxyBaseUrl, extensionToken } = await getProxyConfig();
  let response;
  try {
    response = await fetch(`${proxyBaseUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Extension-Token": extensionToken
      },
      body: JSON.stringify({ text, dialectContext: dialectContext || [], targetLang, direction })
    });
  } catch (err) {
    return { ok: false, kind: "network_error", message: "Не удалось связаться с прокси." };
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    const kind = body.error === "rate_limited" ? "rate_limited" : "budget_exceeded";
    return { ok: false, kind, message: body.message || "Дневной лимит бюджета на перевод исчерпан." };
  }
  if (!response.ok) {
    return { ok: false, kind: "network_error", message: `Прокси вернул ошибку ${response.status}.` };
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data.translation !== "string") {
    return { ok: false, kind: "network_error", message: "Прокси вернул неожиданный ответ." };
  }
  return { ok: true, translation: data.translation };
}
function guessFileName(url) {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const base = pathname.split("/").pop();
    if (base && /\.\w+$/.test(base)) return base;
  } catch (err) {
  }
  return "voice.ogg";
}
async function handleTranscribe({ url, durationSeconds }) {
  const { proxyBaseUrl, extensionToken } = await getProxyConfig();
  let audioResponse;
  try {
    audioResponse = await fetch(url);
  } catch (err) {
    return { ok: false, kind: "network_error", message: "Не удалось скачать голосовое сообщение." };
  }
  if (!audioResponse.ok) {
    return { ok: false, kind: "network_error", message: `Не удалось скачать голосовое (${audioResponse.status}).` };
  }
  const buffer = await audioResponse.arrayBuffer();
  const contentType = audioResponse.headers.get("content-type") || "application/octet-stream";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType }), guessFileName(url));
  if (typeof durationSeconds === "number") {
    form.append("durationSeconds", String(durationSeconds));
  }
  let response;
  try {
    response = await fetch(`${proxyBaseUrl}/transcribe`, {
      method: "POST",
      headers: { "X-Extension-Token": extensionToken },
      body: form
    });
  } catch (err) {
    return { ok: false, kind: "network_error", message: "Не удалось связаться с прокси." };
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    const kind = body.error === "rate_limited" ? "rate_limited" : "budget_exceeded";
    return { ok: false, kind, message: body.message || "Дневной лимит бюджета исчерпан." };
  }
  if (!response.ok) {
    return { ok: false, kind: "network_error", message: `Прокси вернул ошибку ${response.status}.` };
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data.transcript !== "string") {
    return { ok: false, kind: "network_error", message: "Прокси вернул неожиданный ответ." };
  }
  return { ok: true, transcript: data.transcript, language: data.language };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "translate") {
    handleTranslate(message.payload || {}).then(sendResponse).catch((err) => sendResponse({ ok: false, kind: "network_error", message: String(err) }));
    return true;
  }
  if (message && message.type === "transcribe") {
    handleTranscribe(message.payload || {}).then(sendResponse).catch((err) => sendResponse({ ok: false, kind: "network_error", message: String(err) }));
    return true;
  }
  return false;
});
