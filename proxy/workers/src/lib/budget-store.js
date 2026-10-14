function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function minuteKey() {
  return new Date().toISOString().slice(0, 16);
}

const USAGE_TTL_SECONDS = 60 * 60 * 24 * 50;
const ALERT_TTL_SECONDS = 60 * 60 * 24 * 2;
const READ_CACHE_TTL_SECONDS = 60;
const FLUSH_COST_RATIO = 0.05;
const DEFAULT_FLUSH_INTERVAL_MS = 120_000;

const stateByKv = new WeakMap();

function emptyDelta() {
  return { monthTotal: 0, monthEmp: {}, days: {} };
}

function stateFor(kv) {
  let state = stateByKv.get(kv);
  if (!state) {
    state = {
      pending: new Map(),
      lastWritten: new Map(),
      docCache: new Map(),
      lastFlushMs: 0,
      flushPromise: null,
      rateWindow: "",
      rateHits: new Map(),
      alertsSent: new Set(),
      writesBlockedUntilMs: 0,
      writeErrorLogged: false,
    };
    stateByKv.set(kv, state);
  }
  return state;
}

function flushIntervalMs(cfg) {
  const seconds = cfg && cfg.kvFlushIntervalSeconds;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_FLUSH_INTERVAL_MS;
}

function emptyDoc(month) {
  return { v: 1, month, monthTotal: 0, monthEmp: {}, days: {} };
}

function normalizeDoc(raw, month) {
  if (!raw || typeof raw !== "object") return emptyDoc(month);
  return {
    v: 1,
    month,
    monthTotal: Number(raw.monthTotal) || 0,
    monthEmp: raw.monthEmp && typeof raw.monthEmp === "object" ? { ...raw.monthEmp } : {},
    days: raw.days && typeof raw.days === "object" ? { ...raw.days } : {},
  };
}

function dayOf(doc, date) {
  const day = doc.days[date];
  if (!day || typeof day !== "object") return { total: 0, emp: {} };
  return {
    total: Number(day.total) || 0,
    emp: day.emp && typeof day.emp === "object" ? { ...day.emp } : {},
  };
}

function mergeHighWater(doc, ours) {
  if (!ours) return doc;

  const merged = normalizeDoc(doc, doc.month);
  merged.monthTotal = Math.max(merged.monthTotal, Number(ours.monthTotal) || 0);

  for (const [token, value] of Object.entries(ours.monthEmp || {})) {
    merged.monthEmp[token] = Math.max(Number(merged.monthEmp[token]) || 0, Number(value) || 0);
  }

  for (const [date, ourDay] of Object.entries(ours.days || {})) {
    const current = dayOf(merged, date);
    const next = { total: Math.max(current.total, Number(ourDay.total) || 0), emp: { ...current.emp } };
    for (const [token, value] of Object.entries(ourDay.emp || {})) {
      next.emp[token] = Math.max(Number(next.emp[token]) || 0, Number(value) || 0);
    }
    merged.days[date] = next;
  }

  return merged;
}

async function readDoc(kv, month) {
  const state = stateFor(kv);
  const cached = state.docCache.get(month);
  if (cached && Date.now() - cached.fetchedAtMs < READ_CACHE_TTL_SECONDS * 1000) {
    return cached.doc;
  }

  let raw = null;
  try {
    raw = await kv.get(`usage:${month}`, { type: "json", cacheTtl: READ_CACHE_TTL_SECONDS });
  } catch (err) {
    console.error("Не удалось прочитать бюджет из KV:", err && err.message);
    raw = null;
  }

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      raw = null;
    }
  }

  const doc = mergeHighWater(normalizeDoc(raw, month), state.lastWritten.get(month));
  state.docCache.set(month, { doc, fetchedAtMs: Date.now() });
  return doc;
}

function pendingFor(state, month) {
  let delta = state.pending.get(month);
  if (!delta) {
    delta = emptyDelta();
    state.pending.set(month, delta);
  }
  return delta;
}

function addToDelta(delta, date, token, costUsd) {
  delta.monthTotal += costUsd;
  delta.monthEmp[token] = (delta.monthEmp[token] || 0) + costUsd;

  let day = delta.days[date];
  if (!day) {
    day = { total: 0, emp: {} };
    delta.days[date] = day;
  }
  day.total += costUsd;
  day.emp[token] = (day.emp[token] || 0) + costUsd;
}

function applyDelta(doc, delta) {
  const next = normalizeDoc(doc, doc.month);
  next.monthTotal += delta.monthTotal;

  for (const [token, value] of Object.entries(delta.monthEmp)) {
    next.monthEmp[token] = (Number(next.monthEmp[token]) || 0) + value;
  }

  for (const [date, deltaDay] of Object.entries(delta.days)) {
    const current = dayOf(next, date);
    current.total += deltaDay.total;
    for (const [token, value] of Object.entries(deltaDay.emp)) {
      current.emp[token] = (Number(current.emp[token]) || 0) + value;
    }
    next.days[date] = current;
  }

  return next;
}

function endOfUtcDayMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function noteWriteFailure(state, err) {
  const message = (err && err.message) || String(err);
  const isQuota = /limit exceeded/i.test(message);

  state.writesBlockedUntilMs = isQuota ? endOfUtcDayMs() : Date.now() + 60_000;

  if (!state.writeErrorLogged) {
    state.writeErrorLogged = true;
    console.error(
      isQuota
        ? `Исчерпана суточная квота записи в KV (${message}). Расход продолжаю считать в памяти, ` +
          "запросы обслуживаются; счётчики в KV догонят после полуночи UTC."
        : `Не удалось записать бюджет в KV: ${message}. Повторю позже, запросы не блокирую.`
    );
  }
}

async function flushPending(kv, force = false) {
  const state = stateFor(kv);

  if (!force && Date.now() < state.writesBlockedUntilMs) return;
  if (state.pending.size === 0) return;

  const months = [...state.pending.keys()];
  for (const month of months) {
    const delta = state.pending.get(month);
    if (!delta || delta.monthTotal === 0) {
      state.pending.delete(month);
      continue;
    }

    const base = await readDoc(kv, month);
    const next = applyDelta(base, delta);

    try {
      await kv.put(`usage:${month}`, JSON.stringify(next), { expirationTtl: USAGE_TTL_SECONDS });
    } catch (err) {
      noteWriteFailure(state, err);
      return;
    }

    state.pending.delete(month);
    state.lastWritten.set(month, next);
    state.docCache.set(month, { doc: next, fetchedAtMs: Date.now() });
    state.writeErrorLogged = false;
  }

  state.lastFlushMs = Date.now();
}

function scheduleFlush(kv, force = false) {
  const state = stateFor(kv);

  if (state.flushPromise) return state.flushPromise;

  state.flushPromise = flushPending(kv, force)
    .catch((err) => {
      console.error("Сброс бюджета в KV не удался:", err && err.message);
    })
    .finally(() => {
      state.flushPromise = null;
    });

  return state.flushPromise;
}

async function getCompanyDailyTotalUsd(kv, date = todayKey(), month = monthKey()) {
  const doc = await readDoc(kv, month);
  const pending = stateFor(kv).pending.get(month);
  const pendingDay = pending && pending.days[date];
  return dayOf(doc, date).total + (pendingDay ? pendingDay.total : 0);
}

async function getCompanyMonthlyTotalUsd(kv, month = monthKey()) {
  const doc = await readDoc(kv, month);
  const pending = stateFor(kv).pending.get(month);
  return doc.monthTotal + (pending ? pending.monthTotal : 0);
}

async function getEmployeeDailyTotalUsd(kv, token, date = todayKey(), month = monthKey()) {
  const doc = await readDoc(kv, month);
  const pending = stateFor(kv).pending.get(month);
  const pendingDay = pending && pending.days[date];
  return (dayOf(doc, date).emp[token] || 0) + (pendingDay ? pendingDay.emp[token] || 0 : 0);
}

async function getEmployeeMonthlyTotalUsd(kv, token, month = monthKey()) {
  const doc = await readDoc(kv, month);
  const pending = stateFor(kv).pending.get(month);
  return (doc.monthEmp[token] || 0) + (pending ? pending.monthEmp[token] || 0 : 0);
}

async function checkBudget(kv, cfg, token, estimatedCostUsd) {
  const companyDaily = await getCompanyDailyTotalUsd(kv);
  if (companyDaily + estimatedCostUsd > cfg.dailyBudgetUsd) {
    return { exceeded: true, reason: "company_daily" };
  }

  if (cfg.monthlyBudgetUsd !== null) {
    const companyMonthly = await getCompanyMonthlyTotalUsd(kv);
    if (companyMonthly + estimatedCostUsd > cfg.monthlyBudgetUsd) {
      return { exceeded: true, reason: "company_monthly" };
    }
  }

  if (cfg.employeeDailyBudgetUsd !== null) {
    const employeeDaily = await getEmployeeDailyTotalUsd(kv, token);
    if (employeeDaily + estimatedCostUsd > cfg.employeeDailyBudgetUsd) {
      return { exceeded: true, reason: "employee_daily" };
    }
  }

  return { exceeded: false };
}

async function wouldExceedBudget(kv, cfg, token, estimatedCostUsd) {
  return (await checkBudget(kv, cfg, token, estimatedCostUsd)).exceeded;
}

const ALERT_THRESHOLDS = [0.8, 1.0];

function sendAlertWebhook(cfg, payload) {
  if (!cfg.alertWebhookUrl) return Promise.resolve();
  return fetch(cfg.alertWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error("Не удалось отправить алерт о бюджете:", err.message);
  });
}

async function checkAndSendBudgetAlerts(kv, cfg, employeeName) {
  if (!cfg.alertWebhookUrl || cfg.dailyBudgetUsd <= 0) return;

  const state = stateFor(kv);
  const date = todayKey();
  const spent = await getCompanyDailyTotalUsd(kv, date);
  const ratio = spent / cfg.dailyBudgetUsd;

  for (const threshold of ALERT_THRESHOLDS) {
    if (ratio < threshold) continue;

    const memoKey = `${date}:${threshold}`;
    if (state.alertsSent.has(memoKey)) continue;

    const flagKey = `alert:${date}:${threshold}`;
    try {
      if (await kv.get(flagKey)) {
        state.alertsSent.add(memoKey);
        continue;
      }
    } catch (_) {}

    state.alertsSent.add(memoKey);

    if (Date.now() >= state.writesBlockedUntilMs) {
      try {
        await kv.put(flagKey, "1", { expirationTtl: ALERT_TTL_SECONDS });
      } catch (err) {
        noteWriteFailure(state, err);
      }
    }

    await sendAlertWebhook(cfg, {
      type: "budget_threshold",
      thresholdPercent: Math.round(threshold * 100),
      spentUsd: Number(spent.toFixed(4)),
      limitUsd: cfg.dailyBudgetUsd,
      lastEmployee: employeeName,
      date,
    });
  }
}

function recordCost(kv, cfg, token, employeeName, costUsd) {
  const state = stateFor(kv);
  const month = monthKey();

  if (Number.isFinite(costUsd) && costUsd > 0) {
    addToDelta(pendingFor(state, month), todayKey(), token, costUsd);
    state.docCache.delete(month);
  }

  const pending = state.pending.get(month);
  const spentUnflushed = pending ? pending.monthTotal : 0;
  const costThreshold = cfg.dailyBudgetUsd > 0 ? cfg.dailyBudgetUsd * FLUSH_COST_RATIO : Infinity;
  const dueByTime = Date.now() - state.lastFlushMs >= flushIntervalMs(cfg);
  const dueByCost = spentUnflushed >= costThreshold;

  const work = [];
  if (spentUnflushed > 0 && (dueByTime || dueByCost)) {
    work.push(scheduleFlush(kv));
  }
  work.push(
    checkAndSendBudgetAlerts(kv, cfg, employeeName).catch((err) => {
      console.error("Проверка порогов бюджета не удалась:", err && err.message);
    })
  );

  return Promise.all(work);
}

async function getBudgetStatus(kv, cfg, token) {
  const spent = await getCompanyDailyTotalUsd(kv);
  const status = {
    limitUsd: cfg.dailyBudgetUsd,
    spentUsd: Number(spent.toFixed(4)),
    remainingUsd: Number(Math.max(0, cfg.dailyBudgetUsd - spent).toFixed(4)),
    monthly: null,
    employee: null,
  };

  if (cfg.monthlyBudgetUsd !== null) {
    const monthlySpent = await getCompanyMonthlyTotalUsd(kv);
    status.monthly = {
      limitUsd: cfg.monthlyBudgetUsd,
      spentUsd: Number(monthlySpent.toFixed(4)),
      remainingUsd: Number(Math.max(0, cfg.monthlyBudgetUsd - monthlySpent).toFixed(4)),
    };
  }

  if (token && cfg.employeeDailyBudgetUsd !== null) {
    const employeeSpent = await getEmployeeDailyTotalUsd(kv, token);
    status.employee = {
      name: cfg.employeeTokens[token] || null,
      limitUsd: cfg.employeeDailyBudgetUsd,
      spentUsd: Number(employeeSpent.toFixed(4)),
      remainingUsd: Number(Math.max(0, cfg.employeeDailyBudgetUsd - employeeSpent).toFixed(4)),
    };
  }

  return status;
}

async function getAdminUsageReport(kv, cfg) {
  const date = todayKey();
  const month = monthKey();

  const employees = await Promise.all(
    Object.entries(cfg.employeeTokens).map(async ([token, name]) => ({
      name,
      spentTodayUsd: Number((await getEmployeeDailyTotalUsd(kv, token, date, month)).toFixed(4)),
      spentMonthUsd: Number((await getEmployeeMonthlyTotalUsd(kv, token, month)).toFixed(4)),
    }))
  );
  employees.sort((a, b) => b.spentTodayUsd - a.spentTodayUsd);

  return {
    date,
    month,
    company: {
      dailyLimitUsd: cfg.dailyBudgetUsd,
      spentTodayUsd: Number((await getCompanyDailyTotalUsd(kv, date, month)).toFixed(4)),
      monthlyLimitUsd: cfg.monthlyBudgetUsd,
      spentMonthUsd: Number((await getCompanyMonthlyTotalUsd(kv, month)).toFixed(4)),
    },
    employeeDailyLimitUsd: cfg.employeeDailyBudgetUsd,
    employees,
  };
}

function checkRateLimit(kv, cfg, token) {
  const state = stateFor(kv);
  const window = minuteKey();
  if (state.rateWindow !== window) {
    state.rateWindow = window;
    state.rateHits.clear();
  }
  return (state.rateHits.get(token) || 0) < cfg.rateLimitPerMinute;
}

function recordRateLimitHit(kv, token) {
  const state = stateFor(kv);
  const window = minuteKey();
  if (state.rateWindow !== window) {
    state.rateWindow = window;
    state.rateHits.clear();
  }
  state.rateHits.set(token, (state.rateHits.get(token) || 0) + 1);
}

function flushNow(kv) {
  return scheduleFlush(kv, true);
}

export {
  checkBudget,
  wouldExceedBudget,
  recordCost,
  getBudgetStatus,
  getAdminUsageReport,
  checkRateLimit,
  recordRateLimitHit,
  flushNow,
};
