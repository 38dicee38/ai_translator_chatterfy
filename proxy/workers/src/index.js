import { config as buildConfig } from "./config.js";
import * as budgetStore from "./lib/budget-store.js";
import * as openai from "./lib/openai.js";
import { estimateTranslateCostUsd, estimateTranscribeCostUsdFromFileSize, estimateTranscribeCostUsdFromDuration } from "./lib/pricing.js";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function parseDurationSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REASON_MESSAGES = {
  company_daily: "Дневной лимит бюджета компании на перевод/расшифровку исчерпан. Попробуйте завтра.",
  company_monthly: "Месячный лимит бюджета компании исчерпан. Попробуйте в следующем месяце.",
  employee_daily: "Ваш персональный дневной лимит исчерпан. Остальные сотрудники компании могут продолжать пользоваться сервисом.",
};

function budgetExceededResponse(reason, budget) {
  return json(
    {
      error: "budget_exceeded",
      reason,
      message: REASON_MESSAGES[reason],
      budget,
    },
    429
  );
}

function rateLimitedResponse(cfg) {
  return json(
    {
      error: "rate_limited",
      message: `Слишком много запросов (лимит ${cfg.rateLimitPerMinute}/мин). Подождите немного.`,
    },
    429
  );
}

function background(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
    return Promise.resolve();
  }
  return promise;
}

async function enforceLimits(env, cfg, token, estimatedCostUsd) {
  if (!budgetStore.checkRateLimit(env.BUDGET_KV, cfg, token)) {
    return rateLimitedResponse(cfg);
  }
  budgetStore.recordRateLimitHit(env.BUDGET_KV, token);

  const result = await budgetStore.checkBudget(env.BUDGET_KV, cfg, token, estimatedCostUsd);
  if (result.exceeded) {
    return budgetExceededResponse(result.reason, await budgetStore.getBudgetStatus(env.BUDGET_KV, cfg, token));
  }

  return null;
}

async function handleHealth(request, cfg, env) {
  const provided = request.headers.get("X-Extension-Token");
  const token = provided && cfg.employeeTokens[provided] ? provided : null;
  const budget = await budgetStore.getBudgetStatus(env.BUDGET_KV, cfg, token);
  return json({ ok: true, mockMode: cfg.mockMode, budget });
}

async function handleAdminUsage(request, cfg, env) {
  const provided = request.headers.get("X-Admin-Token");
  if (!cfg.adminToken || !provided || provided !== cfg.adminToken) {
    return json({ error: "unauthorized", message: "Неверный или отсутствующий X-Admin-Token." }, 401);
  }
  return json(await budgetStore.getAdminUsageReport(env.BUDGET_KV, cfg));
}

async function handleTranslate(request, cfg, env, auth, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "bad_request", message: "Тело запроса должно быть JSON." }, 400);
  }

  const { text, dialectContext, targetLang } = body || {};
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "bad_request", message: "Поле text обязательно и должно быть непустой строкой." }, 400);
  }
  if (dialectContext !== void 0 && !Array.isArray(dialectContext)) {
    return json({ error: "bad_request", message: "Поле dialectContext должно быть массивом строк." }, 400);
  }
  const direction = body.direction === "to_operator_language" ? "to_operator_language" : "to_dialect";

  const estimatedCostUsd = estimateTranslateCostUsd({ text, dialectContext });
  const limitResponse = await enforceLimits(env, cfg, auth.token, estimatedCostUsd);
  if (limitResponse) return limitResponse;

  const result = await openai.translate(cfg, { text, dialectContext: dialectContext || [], targetLang, direction });

  await background(ctx, budgetStore.recordCost(env.BUDGET_KV, cfg, auth.token, auth.name, result.costUsd));

  return json({ translation: result.translation });
}

async function handleTranscribe(request, cfg, env, auth, ctx) {
  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ error: "bad_request", message: "Ожидается multipart/form-data." }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "bad_request", message: "Поле file (multipart) обязательно." }, 400);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return json({ error: "bad_request", message: "Файл слишком большой (лимит 25MB)." }, 400);
  }

  const durationSeconds = parseDurationSeconds(form.get("durationSeconds"));
  const estimatedCostUsd = durationSeconds !== void 0
    ? estimateTranscribeCostUsdFromDuration(durationSeconds)
    : estimateTranscribeCostUsdFromFileSize(file.size);
  const limitResponse = await enforceLimits(env, cfg, auth.token, estimatedCostUsd);
  if (limitResponse) return limitResponse;

  const fileBuffer = new Uint8Array(await file.arrayBuffer());
  const result = await openai.transcribe(cfg, { fileBuffer, fileName: file.name, mimeType: file.type, durationSeconds });

  await background(ctx, budgetStore.recordCost(env.BUDGET_KV, cfg, auth.token, auth.name, result.costUsd));

  return json({ transcript: result.transcript, language: result.language });
}

export default {
  async fetch(request, env, ctx) {
    const cfg = buildConfig(env);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(request, cfg, env);
    }

    if (request.method === "GET" && url.pathname === "/admin/usage") {
      return handleAdminUsage(request, cfg, env);
    }

    if (Object.keys(cfg.employeeTokens).length === 0) {
      return json({ error: "server_misconfigured", message: "Ни EXTENSION_TOKENS, ни EXTENSION_TOKEN не заданы на сервере." }, 500);
    }

    const provided = request.headers.get("X-Extension-Token");
    const employeeName = provided && cfg.employeeTokens[provided];
    if (!provided || !employeeName) {
      return json({ error: "unauthorized", message: "Неверный или отсутствующий X-Extension-Token." }, 401);
    }
    const auth = { token: provided, name: employeeName };

    if (request.method === "POST" && url.pathname === "/translate") {
      return handleTranslate(request, cfg, env, auth, ctx);
    }
    if (request.method === "POST" && url.pathname === "/transcribe") {
      return handleTranscribe(request, cfg, env, auth, ctx);
    }

    return json({ error: "not_found", message: "Неизвестный маршрут." }, 404);
  },
};
