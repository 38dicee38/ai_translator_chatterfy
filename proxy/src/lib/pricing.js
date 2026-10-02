const OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD = 0.4;
const OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD = 1.6;
const TRANSCRIBE_PRICE_PER_MINUTE_USD = 45e-4;
function estimateTokensFromText(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
function estimateTranslateCostUsd({ text, dialectContext }) {
  const contextText = Array.isArray(dialectContext) ? dialectContext.join(" ") : "";
  const inputTokens = estimateTokensFromText(text) + estimateTokensFromText(contextText) + 200;
  const outputTokens = estimateTokensFromText(text) + 50;
  const inputCost = inputTokens / 1e6 * OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD;
  const outputCost = outputTokens / 1e6 * OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD;
  return inputCost + outputCost;
}
const ASSUMED_BYTES_PER_SECOND = 2500;
function estimateTranscribeCostUsdFromFileSize(fileSizeBytes) {
  const estimatedSeconds = fileSizeBytes / ASSUMED_BYTES_PER_SECOND;
  const estimatedMinutes = estimatedSeconds / 60;
  return estimatedMinutes * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}
function estimateTranscribeCostUsdFromDuration(durationSeconds) {
  return durationSeconds / 60 * TRANSCRIBE_PRICE_PER_MINUTE_USD;
}
function computeChatCostUsdFromUsage(usage) {
  if (!usage) return 0;
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  const inputCost = inputTokens / 1e6 * OPENAI_CHAT_PRICE_PER_1M_INPUT_TOKENS_USD;
  const outputCost = outputTokens / 1e6 * OPENAI_CHAT_PRICE_PER_1M_OUTPUT_TOKENS_USD;
  return inputCost + outputCost;
}
module.exports = {
  estimateTranslateCostUsd,
  estimateTranscribeCostUsdFromFileSize,
  estimateTranscribeCostUsdFromDuration,
  computeChatCostUsdFromUsage
};
