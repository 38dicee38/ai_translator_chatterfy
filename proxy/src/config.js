require("dotenv").config();
const MOCK_MODE = process.env.MOCK_MODE === "true";
function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return value !== void 0 && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
}
function nullableNumberFromEnv(value) {
  if (value === void 0 || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseEmployeeTokens(rawJson, legacySingleToken) {
  const map = {};
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      for (const [token, name] of Object.entries(parsed)) {
        if (token) map[token] = String(name || token);
      }
    } catch (err) {
      console.error("EXTENSION_TOKENS не распарсился как JSON, игнорирую:", err.message);
    }
  }
  if (Object.keys(map).length === 0 && legacySingleToken) {
    map[legacySingleToken] = "default";
  }
  return map;
}
const config = {
  port: numberFromEnv(process.env.PORT, 8787),
  mockMode: MOCK_MODE,
  extensionToken: process.env.EXTENSION_TOKEN || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  dailyBudgetUsd: numberFromEnv(process.env.DAILY_BUDGET_USD, 5),
  monthlyBudgetUsd: nullableNumberFromEnv(process.env.MONTHLY_BUDGET_USD),
  employeeDailyBudgetUsd: nullableNumberFromEnv(process.env.EMPLOYEE_DAILY_BUDGET_USD),
  employeeTokens: parseEmployeeTokens(process.env.EXTENSION_TOKENS, process.env.EXTENSION_TOKEN),
  rateLimitPerMinute: numberFromEnv(process.env.RATE_LIMIT_PER_MINUTE, 20),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || "",
  adminToken: process.env.ADMIN_TOKEN || ""
};
function assertStartupInvariants() {
  const problems = [];
  if (Object.keys(config.employeeTokens).length === 0) {
    problems.push("Ни EXTENSION_TOKENS, ни EXTENSION_TOKEN не заданы — авторизация прокси невозможна.");
  }
  if (!config.mockMode) {
    if (!config.openaiApiKey) {
      problems.push("MOCK_MODE=false, но OPENAI_API_KEY пуст.");
    }
  }
  if (problems.length > 0) {
    console.error("Прокси не запущен, обнаружены проблемы конфигурации:\n" + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
}
module.exports = { config, assertStartupInvariants };
