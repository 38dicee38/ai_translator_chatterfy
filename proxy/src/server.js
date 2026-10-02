const express = require("express");
const { config, assertStartupInvariants } = require("./config");
const { requireExtensionToken } = require("./middleware/auth");
const { getBudgetStatus } = require("./lib/budget-store");
const translateRoute = require("./routes/translate");
const transcribeRoute = require("./routes/transcribe");
const adminRoute = require("./routes/admin");
assertStartupInvariants();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.get("/health", (req, res) => {
  const provided = req.get("X-Extension-Token");
  const token = provided && config.employeeTokens[provided] ? provided : null;
  res.json({ ok: true, mockMode: config.mockMode, budget: getBudgetStatus(token) });
});
app.use(adminRoute);
app.use(requireExtensionToken);
app.use(translateRoute);
app.use(transcribeRoute);
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error", message: "Внутренняя ошибка прокси." });
});
app.listen(config.port, () => {
  console.log(`Прокси запущен на http://localhost:${config.port} (MOCK_MODE=${config.mockMode})`);
});
