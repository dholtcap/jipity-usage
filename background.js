const AUTH_ENDPOINT = "https://chatgpt.com/api/auth/session";
const USAGE_ENDPOINTS = [
  "https://chatgpt.com/backend-api/wham/usage",
  "https://chatgpt.com/backend-api/codex/usage"
];

const POLL_MINUTES = 1;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const HISTORY_SAMPLE_MS = 60 * 1000;
const MAX_HISTORY_POINTS = 10_500;
const AUTH_CACHE_KEY = "sessionAuthCache";
const AUTH_EXPIRY_SKEW_MS = 60 * 1000;

let fetchInFlight = null;

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function tokenExpiryMs(token) {
  const payload = decodeJwtPayload(token);
  const expirySeconds = Number(payload?.exp);
  return Number.isFinite(expirySeconds) ? expirySeconds * 1000 : null;
}

function findAccountId(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return null;

  for (const key of [
    "account_id",
    "accountId",
    "chatgpt_account_id",
    "chatgptAccountId",
    "active_account_id",
    "activeAccountId"
  ]) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }

  for (const candidate of [
    value.account,
    value.activeAccount,
    value.active_account,
    value.user?.account
  ]) {
    if (candidate && typeof candidate.id === "string" && candidate.id) {
      return candidate.id;
    }
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") {
      const found = findAccountId(nested, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

async function cacheAuthContext(accessToken, accountId) {
  try {
    await chrome.storage.session.set({
      [AUTH_CACHE_KEY]: {
        accessToken,
        accountId: accountId || null,
        expiresAtMs: tokenExpiryMs(accessToken),
        cachedAtMs: Date.now()
      }
    });
  } catch {
    // Session caching is only a latency optimization.
  }
}

async function clearCachedAuthContext() {
  try {
    await chrome.storage.session.remove(AUTH_CACHE_KEY);
  } catch {
    // Best effort.
  }
}

async function getCachedAuthContext() {
  try {
    const stored = await chrome.storage.session.get([AUTH_CACHE_KEY]);
    const cached = stored?.[AUTH_CACHE_KEY];
    if (!cached?.accessToken) return null;

    const expiresAtMs = Number(cached.expiresAtMs);
    if (
      Number.isFinite(expiresAtMs) &&
      Date.now() >= expiresAtMs - AUTH_EXPIRY_SKEW_MS
    ) {
      await clearCachedAuthContext();
      return null;
    }

    return {
      accessToken: cached.accessToken,
      accountId: cached.accountId || null,
      source: "session-cache"
    };
  } catch {
    return null;
  }
}

async function getLiveSessionContext() {
  const response = await fetch(AUTH_ENDPOINT, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    const error = new Error(`Could not read ChatGPT session (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }

  const session = await response.json();
  const accessToken = session.accessToken || session.access_token;

  if (!accessToken) {
    throw new Error("ChatGPT session is not signed in");
  }

  const tokenPayload = decodeJwtPayload(accessToken);
  const stored = await chrome.storage.local.get(["activeAccountId"]);
  const accountId =
    findAccountId(session) ||
    findAccountId(tokenPayload) ||
    stored.activeAccountId ||
    null;

  await cacheAuthContext(accessToken, accountId);

  return {
    accessToken,
    accountId,
    source: "live-session"
  };
}

async function getFastSessionContext() {
  // Prefer the already-validated session token so the popup only needs one
  // network request in the common case.
  return (await getCachedAuthContext()) || getLiveSessionContext();
}

function findWeeklyWindow(data) {
  const rateLimit = data?.rate_limit || data?.rate_limits;
  if (!rateLimit) return null;

  if (rateLimit.weekly) return rateLimit.weekly;

  const candidates = [
    rateLimit.primary_window,
    rateLimit.secondary_window,
    rateLimit.primary,
    rateLimit.secondary
  ].filter(Boolean);

  if (!candidates.length) return null;

  const withDuration = candidates.filter((window) =>
    Number.isFinite(Number(window.limit_window_seconds))
  );

  if (withDuration.length) {
    return withDuration.reduce((best, current) => {
      const bestDistance = Math.abs(Number(best.limit_window_seconds) - WEEK_SECONDS);
      const currentDistance = Math.abs(Number(current.limit_window_seconds) - WEEK_SECONDS);
      return currentDistance < bestDistance ? current : best;
    });
  }

  return (
    rateLimit.secondary_window ||
    rateLimit.secondary ||
    rateLimit.primary_window ||
    rateLimit.primary ||
    candidates[0]
  );
}

function normalizeWeeklyWindow(data) {
  const window = findWeeklyWindow(data);
  if (!window) return null;

  let usedPct = Number(window.used_percent ?? window.usedPercent);
  if (!Number.isFinite(usedPct) && Number.isFinite(Number(window.percent_left))) {
    usedPct = 100 - Number(window.percent_left);
  }

  const windowSeconds = Number(window.limit_window_seconds) || WEEK_SECONDS;
  const resetAtRaw = window.reset_at ?? window.resetsAt ?? window.reset_time_ms;
  let resetAtMs = null;

  if (Number.isFinite(Number(resetAtRaw))) {
    const numeric = Number(resetAtRaw);
    resetAtMs = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  } else if (typeof resetAtRaw === "string") {
    const parsed = Date.parse(resetAtRaw);
    if (Number.isFinite(parsed)) resetAtMs = parsed;
  }

  if (!Number.isFinite(usedPct) || !resetAtMs) return null;

  return {
    usedPct: Math.min(100, Math.max(0, usedPct)),
    leftPct: Math.min(100, Math.max(0, 100 - usedPct)),
    resetAtMs,
    windowSeconds,
    source: "api"
  };
}

function httpError(prefix, status) {
  const error = new Error(`${prefix} (HTTP ${status})`);
  error.status = status;
  return error;
}

async function fetchUsageFromApi({ accessToken, accountId }) {
  let lastError = null;

  for (const endpoint of USAGE_ENDPOINTS) {
    try {
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      };

      if (accountId) {
        headers["ChatGPT-Account-Id"] = accountId;
      }

      const response = await fetch(endpoint, {
        credentials: "include",
        cache: "no-store",
        headers
      });

      if (!response.ok) {
        lastError = httpError("Usage request failed", response.status);
        continue;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not fetch ChatGPT usage");
}

async function fetchUsageWithAuthRecovery() {
  let context = await getFastSessionContext();

  try {
    const raw = await fetchUsageFromApi(context);
    return { raw, context };
  } catch (error) {
    const status = Number(error?.status);

    if (
      context.source === "session-cache" &&
      (status === 401 || status === 403)
    ) {
      await clearCachedAuthContext();
      context = await getLiveSessionContext();
      const raw = await fetchUsageFromApi(context);
      return { raw, context };
    }

    throw error;
  }
}

async function buildUpdatedHistory(weekly) {
  const now = Date.now();
  const sampleTs = Math.min(now, weekly.resetAtMs);
  const startAtMs = weekly.resetAtMs - weekly.windowSeconds * 1000;
  const stored = await chrome.storage.local.get(["usageHistory"]);
  let history = Array.isArray(stored.usageHistory) ? stored.usageHistory : [];

  history = history
    .filter((point) =>
      Number(point.resetAtMs) === Number(weekly.resetAtMs) &&
      Number(point.ts) >= startAtMs &&
      Number(point.ts) <= weekly.resetAtMs &&
      Number.isFinite(Number(point.usedPct))
    )
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  const nextPoint = {
    ts: sampleTs,
    usedPct: weekly.usedPct,
    resetAtMs: weekly.resetAtMs
  };

  const last = history[history.length - 1];

  if (!last) {
    history.push(nextPoint);
  } else if (sampleTs - Number(last.ts) >= HISTORY_SAMPLE_MS) {
    history.push(nextPoint);
  } else if (
    sampleTs >= Number(last.ts) &&
    Math.abs(Number(last.usedPct) - weekly.usedPct) >= 0.0001
  ) {
    history[history.length - 1] = nextPoint;
  }

  if (history.length > MAX_HISTORY_POINTS) {
    history = history.slice(history.length - MAX_HISTORY_POINTS);
  }

  return history;
}

async function updateActionTitle(weekly) {
  if (!weekly) {
    await chrome.action.setTitle({ title: "Jipity Usage" });
    return;
  }

  const remainingHours = Math.max(0, (weekly.resetAtMs - Date.now()) / 3_600_000);
  await chrome.action.setTitle({
    title: `Jipity Usage — ${weekly.usedPct.toFixed(1)}% used, ${remainingHours.toFixed(1)}h to reset`
  });
}

async function performUsageFetch() {
  try {
    const { raw, context } = await fetchUsageWithAuthRecovery();
    const weekly = normalizeWeeklyWindow(raw);

    if (!weekly) {
      throw new Error("Weekly usage window was not present in the usage response");
    }

    const activeAccountId = raw?.account_id || context.accountId || null;
    const usageData = {
      weekly,
      lastUpdated: Date.now()
    };
    const usageHistory = await buildUpdatedHistory(weekly);

    await chrome.storage.local.set({
      usageData,
      usageHistory,
      activeAccountId,
      lastError: null,
      lastErrorAt: null
    });

    await updateActionTitle(weekly);
    return usageData;
  } catch (error) {
    const status = Number(error?.status);
    if (status === 401 || status === 403) {
      await clearCachedAuthContext();
    }

    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({
      lastError: message,
      lastErrorAt: Date.now()
    });

    throw new Error(message);
  }
}

function fetchUsageData() {
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = performUsageFetch().finally(() => {
    fetchInFlight = null;
  });

  return fetchInFlight;
}

async function ensureRefreshAlarm() {
  const existing = await chrome.alarms.get("refreshUsage");
  if (!existing) {
    chrome.alarms.create("refreshUsage", { periodInMinutes: POLL_MINUTES });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureRefreshAlarm().catch(() => {});
  fetchUsageData().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureRefreshAlarm().catch(() => {});
  fetchUsageData().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshUsage") {
    fetchUsageData().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === "refreshUsage") {
    fetchUsageData()
      .then((data) => sendResponse({ ok: true, data }))
      .catch(async (error) => {
        const stored = await chrome.storage.local.get(["usageData", "lastError"]);
        sendResponse({
          ok: false,
          data: stored.usageData || null,
          error: stored.lastError || error.message
        });
      });
    return true;
  }

  if (request?.action === "getUsage") {
    chrome.storage.local.get(["usageData", "usageHistory", "lastError"], (stored) => {
      sendResponse({
        ok: Boolean(stored.usageData),
        data: stored.usageData || null,
        history: stored.usageHistory || [],
        error: stored.lastError || null
      });
    });
    return true;
  }

  return false;
});

ensureRefreshAlarm().catch(() => {});
