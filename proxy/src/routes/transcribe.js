const express = require("express");
const multer = require("multer");
const { enforceBudget, enforceRateLimit } = require("../middleware/budget");
const { estimateTranscribeCostUsdFromFileSize, estimateTranscribeCostUsdFromDuration } = require("../lib/pricing");
const { recordCost } = require("../lib/budget-store");
const openai = require("../lib/openai");
function parseDurationSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});
router.post(
  "/transcribe",
  upload.single("file"),
  (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: "bad_request", message: "Поле file (multipart) обязательно." });
    }
    next();
  },
  enforceRateLimit,
  enforceBudget((req) => {
    const durationSeconds = parseDurationSeconds(req.body && req.body.durationSeconds);
    return durationSeconds !== void 0 ? estimateTranscribeCostUsdFromDuration(durationSeconds) : estimateTranscribeCostUsdFromFileSize(req.file.size);
  }),
  async (req, res, next) => {
    try {
      const result = await openai.transcribe({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        durationSeconds: parseDurationSeconds(req.body && req.body.durationSeconds)
      });
      recordCost(req.employeeToken, req.employeeName, result.costUsd);
      res.json({ transcript: result.transcript, language: result.language });
    } catch (err) {
      next(err);
    }
  }
);
module.exports = router;
