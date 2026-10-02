const { config } = require("../config");
function requireExtensionToken(req, res, next) {
  const provided = req.get("X-Extension-Token");
  const employeeName = provided && config.employeeTokens[provided];
  if (!provided || !employeeName) {
    return res.status(401).json({ error: "unauthorized", message: "Неверный или отсутствующий X-Extension-Token." });
  }
  req.employeeToken = provided;
  req.employeeName = employeeName;
  next();
}
function requireAdminToken(req, res, next) {
  const provided = req.get("X-Admin-Token");
  if (!config.adminToken || !provided || provided !== config.adminToken) {
    return res.status(401).json({ error: "unauthorized", message: "Неверный или отсутствующий X-Admin-Token." });
  }
  next();
}
module.exports = { requireExtensionToken, requireAdminToken };
