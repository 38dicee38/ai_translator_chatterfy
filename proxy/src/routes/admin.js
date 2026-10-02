const express = require("express");
const { requireAdminToken } = require("../middleware/auth");
const { getAdminUsageReport } = require("../lib/budget-store");
const router = express.Router();
router.get("/admin/usage", requireAdminToken, (req, res) => {
  res.json(getAdminUsageReport());
});
module.exports = router;
