const { checkBudget, getBudgetStatus, checkRateLimit, recordRateLimitHit } = require("../lib/budget-store");
const { config } = require("../config");
const REASON_MESSAGES = {
  company_daily: "Дневной лимит бюджета компании на перевод/расшифровку исчерпан. Попробуйте завтра.",
  company_monthly: "Месячный лимит бюджета компании исчерпан. Попробуйте в следующем месяце.",
  employee_daily: "Ваш персональный дневной лимит исчерпан. Остальные сотрудники компании могут продолжать пользоваться сервисом."
};
function enforceRateLimit(req, res, next) {
  if (!checkRateLimit(req.employeeToken)) {
    return res.status(429).json({
      error: "rate_limited",
      message: `Слишком много запросов (лимит ${config.rateLimitPerMinute}/мин). Подождите немного.`
    });
  }
  recordRateLimitHit(req.employeeToken);
  next();
}
function enforceBudget(estimateCostUsd) {
  return (req, res, next) => {
    const estimatedCostUsd = estimateCostUsd(req);
    const result = checkBudget(req.employeeToken, estimatedCostUsd);
    if (result.exceeded) {
      return res.status(429).json({
        error: "budget_exceeded",
        reason: result.reason,
        message: REASON_MESSAGES[result.reason],
        budget: getBudgetStatus(req.employeeToken)
      });
    }
    req.estimatedCostUsd = estimatedCostUsd;
    next();
  };
}
module.exports = { enforceBudget, enforceRateLimit };
