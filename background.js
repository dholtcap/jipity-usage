const AUTH_ENDPOINT = "https://chatgpt.com/api/auth/session";
const USAGE_ENDPOINTS = [
  "https://chatgpt.com/backend-api/wham/usage",
  "https://chatgpt.com/backend-api/codex/usage"
];
const POLL_MINUTES = 1;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const HISTORY_SAMPLE_MS = 5 * 60 * 1000;
const MAX_HISTORY_POINTS = 2200;

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

function findAccountId(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return null;

  const directKeys = [
    "account_id",
    "accountId",
    "chatgpt_account_id",
    "chatgptAccountId",
    "active_account_id",
    "activeAccountId"
  ];

  for (const key of directKeys) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }

  const directObjects = [
    value.account,
    value.activeAccount,
    value.active_account,
    value.user?.account
  ];

  for (const candidate of directObjects) {
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

async function getSessionContext() {
  const response = await fetch(AUTH_ENDPOINT, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Could not read ChatGPT session (HTTP ${response.status})`);
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

  return { accessToken, accountId };
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

  return rateLimit.secondary_window || rateLimit.secondary || rateLimit.primary_window || rateLimit.primary || candidates[0];
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
        headers
      });

      if (!response.ok) {
        lastError = new Error(`Usage request failed (HTTP ${response.status})`);
        continue;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not fetch ChatGPT usage");
}

async function recordHistory(weekly) {
  const now = Date.now();
  const startAtMs = weekly.resetAtMs - weekly.windowSeconds * 1000;
  const stored = await chrome.storage.local.get(["usageHistory"]);
  let history = Array.isArray(stored.usageHistory) ? stored.usageHistory : [];

  history = history.filter((point) =>
    Number(point.resetAtMs) === Number(weekly.resetAtMs) &&
    Number(point.ts) >= startAtMs &&
    Number(point.ts) <= weekly.resetAtMs
  );

  const last = history[history.length - 1];
  const shouldAdd =
    !last ||
    Math.abs(Number(last.usedPct) - weekly.usedPct) >= 0.05 ||
    now - Number(last.ts) >= HISTORY_SAMPLE_MS;

  if (shouldAdd) {
    history.push({
      ts: now,
      usedPct: weekly.usedPct,
      resetAtMs: weekly.resetAtMs
    });
  }

  if (history.length > MAX_HISTORY_POINTS) {
    history = history.slice(history.length - MAX_HISTORY_POINTS);
  }

  await chrome.storage.local.set({ usageHistory: history });
  return history;
}

async function updateActionTitle(weekly) {
  if (!weekly) {
    await chrome.action.setTitle({ title: "Jipity Usage" });
    return;
  }

  const remainingHours = Math.max(0, (weekly.resetAtMs - Date.now()) / 3_600_000);
  await chrome.action.setTitle({
    title: `Jipity Usage — ${weekly.usedPct.toFixed(0)}% used, ${remainingHours.toFixed(1)}h to reset`
  });
}

async function fetchUsageData() {
  try {
    const sessionContext = await getSessionContext();
    const raw = await fetchUsageFromApi(sessionContext);
    const weekly = normalizeWeeklyWindow(raw);

    if (!weekly) {
      throw new Error("Weekly usage window was not present in the usage response");
    }

    const activeAccountId = raw?.account_id || sessionContext.accountId || null;
    const usageData = {
      weekly,
      lastUpdated: Date.now()
    };

    await chrome.storage.local.set({
      usageData,
      activeAccountId,
      lastError: null,
      lastErrorAt: null
    });

    await recordHistory(weekly);
    await updateActionTitle(weekly);
    return usageData;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({
      lastError: message,
      lastErrorAt: Date.now()
    });
    throw new Error(message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refreshUsage", { periodInMinutes: POLL_MINUTES });
  fetchUsageData().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("refreshUsage", { periodInMinutes: POLL_MINUTES });
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

chrome.alarms.create("refreshUsage", { periodInMinutes: POLL_MINUTES });
fetchUsageData().catch(() => {});
