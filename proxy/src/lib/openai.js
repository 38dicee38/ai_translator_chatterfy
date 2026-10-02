const { config } = require("../config");
const {
  estimateTranscribeCostUsdFromFileSize,
  estimateTranscribeCostUsdFromDuration,
  estimateTranslateCostUsd,
  computeChatCostUsdFromUsage
} = require("./pricing");
async function transcribe({ fileBuffer, fileName, mimeType, durationSeconds }) {
  const estimatedCostUsd = typeof durationSeconds === "number" ? estimateTranscribeCostUsdFromDuration(durationSeconds) : estimateTranscribeCostUsdFromFileSize(fileBuffer.length);
  if (config.mockMode) {
    return {
      transcript: "[MOCK расшифровка] это фиктивный текст голосового сообщения для проверки скелета прокси",
      language: "ar",
      costUsd: estimatedCostUsd
    };
  }
  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);
  form.append("model", "gpt-transcribe");
  form.append("response_format", "json");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    body: form
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  return { transcript: data.text ?? "", language: data.language, costUsd: estimatedCostUsd };
}
const TRANSLATE_SYSTEM_PROMPT = 'Ты выполняешь только одну задачу — перевод текста. Отвечай СТРОГО только самим переводом: без пояснений, без анализа языка/диалекта, без вариантов, без вводных фраз вроде "Похоже, это..." или "Примерный смысл:", без кавычек вокруг перевода. Даже если текст короткий, неоднозначный или содержит опечатки — всё равно дай один наиболее вероятный перевод, никогда не описывай, что текст непонятен. Переводи ВЕСЬ текст целиком, включая приветствия и вводные слова — не оставляй отдельные слова непереведёнными на исходном языке, даже если они кажутся общепонятными.';
function buildTranslatePrompt({ text, dialectContext, targetLang, direction }) {
  const contextBlock = (dialectContext || []).map((line, i) => `${i + 1}. "${line}"`).join("\n");
  if (direction === "to_operator_language") {
    return `Вот сообщение от собеседника и контекст последних его сообщений (для лучшего понимания диалекта/сленга):
${contextBlock || "(контекст пуст)"}

Переведи следующее сообщение собеседника на литературный русский язык, сохраняя смысл и тон:
"${text}"

Ответь только переводом, без пояснений.`;
  }
  if (!contextBlock && !targetLang) {
    return `Контекст диалекта собеседника недоступен (это либо самое начало переписки, либо ошибка получения истории). Переведи следующий текст оператора на наиболее вероятный естественный разговорный вариант языка, сохраняя тон и уровень формальности — переведи целиком, ни одно слово не должно остаться на исходном языке:
"${text}"

Ответь только переводом, без пояснений.`;
  }
  return `Вот последние сообщения собеседника (используй тот же диалект, стиль И систему письма — если он пишет латиницей/арабизи, а не арабской графикой, отвечай тем же способом):
${contextBlock || "(контекст пуст, ориентируйся только на целевой язык ниже)"}

Переведи следующий текст оператора на тот же диалект${targetLang ? ` (целевой язык: ${targetLang})` : ""} целиком — ни одно слово, включая приветствия, не должно остаться непереведённым, сохраняя тон и уровень формальности:
"${text}"

Ответь только переводом, без пояснений.`;
}
async function translate({ text, dialectContext, targetLang, direction }) {
  const estimatedCostUsd = estimateTranslateCostUsd({ text, dialectContext });
  if (config.mockMode) {
    return {
      translation: `[MOCK перевод] ${text}`,
      costUsd: estimatedCostUsd
    };
  }
  const prompt = buildTranslatePrompt({ text, dialectContext, targetLang, direction });
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const translation = (data.choices?.[0]?.message?.content ?? "").trim();
  const actualCostUsd = computeChatCostUsdFromUsage(data.usage) || estimatedCostUsd;
  return { translation, costUsd: actualCostUsd };
}
module.exports = { transcribe, translate, buildTranslatePrompt };
