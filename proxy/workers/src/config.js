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
export function config(env) {
  return {
    mockMode: env.MOCK_MODE === "true",
    extensionToken: env.EXTENSION_TOKEN || "",
    openaiApiKey: env.OPENAI_API_KEY || "",
    dailyBudgetUsd: numberFromEnv(env.DAILY_BUDGET_USD, 5),
    monthlyBudgetUsd: nullableNumberFromEnv(env.MONTHLY_BUDGET_USD),
    employeeDailyBudgetUsd: nullableNumberFromEnv(env.EMPLOYEE_DAILY_BUDGET_USD),
    employeeTokens: parseEmployeeTokens(env.EXTENSION_TOKENS, env.EXTENSION_TOKEN),
    rateLimitPerMinute: numberFromEnv(env.RATE_LIMIT_PER_MINUTE, 20),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || "",
    adminToken: env.ADMIN_TOKEN || ""
  };
}
