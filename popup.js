const WEEK_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_INTERVAL_MS = 30_000;

const elements = {
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  usageView: document.getElementById("usageView"),
  refreshButton: document.getElementById("refreshButton"),
  usedPct: document.getElementById("usedPct"),
  leftPct: document.getElementById("leftPct"),
  progressFill: document.getElementById("progressFill"),
  resetCountdown: document.getElementById("resetCountdown"),
  resetExact: document.getElementById("resetExact"),
  avgRate: document.getElementById("avgRate"),
  avgRateSub: document.getElementById("avgRateSub"),
  paceValue: document.getElementById("paceValue"),
  paceSub: document.getElementById("paceSub"),
  safeRate: document.getElementById("safeRate"),
  projectedUsed: document.getElementById("projectedUsed"),
  projectedSub: document.getElementById("projectedSub"),
  warning: document.getElementById("warning"),
  updatedText: document.getElementById("updatedText")
};

let currentUsageData = null;
let refreshInFlight = false;

function fmt(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function calculate(weekly) {
  const now = Date.now();
  const windowSeconds = Number(weekly.windowSeconds) || WEEK_SECONDS;
  const windowHours = windowSeconds / 3600;
  const resetAtMs = Number(weekly.resetAtMs);
  const startAtMs = resetAtMs - windowSeconds * 1000;

  const elapsedHours = Math.min(
    windowHours,
    Math.max(0, (now - startAtMs) / 3_600_000)
  );
  const remainingHours = Math.max(0, (resetAtMs - now) / 3_600_000);
  const usedPct = Math.min(100, Math.max(0, Number(weekly.usedPct)));
  const leftPct = Math.max(0, 100 - usedPct);
  const elapsedPct = windowHours > 0 ? (elapsedHours / windowHours) * 100 : 0;
  const avgRate = elapsedHours > 0 ? usedPct / elapsedHours : 0;
  const evenRate = windowHours > 0 ? 100 / windowHours : 0;
  const safeRate = remainingHours > 0 ? leftPct / remainingHours : Infinity;
  const pacePoints = usedPct - elapsedPct;
  const relativePace = elapsedPct > 0 ? ((usedPct / elapsedPct) - 1) * 100 : 0;
  const projectedRaw = usedPct + avgRate * remainingHours;
  const hoursUntilExhausted = avgRate > 0 ? leftPct / avgRate : Infinity;

  return {
    usedPct,
    leftPct,
    elapsedHours,
    remainingHours,
    elapsedPct,
    avgRate,
    evenRate,
    safeRate,
    pacePoints,
    relativePace,
    projectedRaw,
    hoursUntilExhausted,
    resetAtMs
  };
}

function formatCountdown(milliseconds) {
  let totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  totalMinutes -= days * 1440;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatExact(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatAge(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

function paceCopy(stats) {
  const absPoints = Math.abs(stats.pacePoints);
  const absRelative = Math.abs(stats.relativePace);

  if (absPoints < 0.15) {
    return {
      value: "On pace",
      sub: "Usage is nearly aligned with an even weekly pace."
    };
  }

  if (stats.pacePoints > 0) {
    return {
      value: `${fmt(absPoints, 1)} pts over pace`,
      sub: `${fmt(absRelative, 1)}% faster than an even weekly pace.`
    };
  }

  return {
    value: `${fmt(absPoints, 1)} pts under pace`,
    sub: `${fmt(absRelative, 1)}% slower than an even weekly pace.`
  };
}

function renderUsage(usageData, errorMessage = null) {
  currentUsageData = usageData;
  const weekly = usageData?.weekly;

  if (!weekly) {
    elements.loadingState.hidden = true;
    elements.usageView.hidden = true;
    elements.errorState.hidden = false;
    elements.errorMessage.textContent = errorMessage || "No weekly usage data is available yet.";
    return;
  }

  const stats = calculate(weekly);
  const pace = paceCopy(stats);

  elements.loadingState.hidden = true;
  elements.usageView.hidden = false;
  elements.errorState.hidden = !errorMessage;
  elements.errorMessage.textContent = errorMessage || "";

  elements.usedPct.textContent = `${fmt(stats.usedPct, 1)}%`;
  elements.leftPct.textContent = `${fmt(stats.leftPct, 1)}% left`;
  elements.progressFill.style.width = `${Math.min(100, stats.usedPct)}%`;

  elements.resetCountdown.textContent = `Resets in ${formatCountdown(stats.resetAtMs - Date.now())}`;
  elements.resetExact.textContent = formatExact(stats.resetAtMs);

  elements.avgRate.textContent = `${fmt(stats.avgRate, 3)}% / hr`;
  elements.avgRateSub.textContent = `Even pace is ${fmt(stats.evenRate, 3)}% / hr`;

  elements.paceValue.textContent = pace.value;
  elements.paceSub.textContent = pace.sub;

  elements.safeRate.textContent = Number.isFinite(stats.safeRate)
    ? `${fmt(stats.safeRate, 3)}% / hr`
    : "—";

  if (stats.projectedRaw >= 100 && Number.isFinite(stats.hoursUntilExhausted)) {
    const hoursEarly = Math.max(0, stats.remainingHours - stats.hoursUntilExhausted);
    elements.projectedUsed.textContent = "100% (hits early)";
    elements.projectedSub.textContent = `At the current average rate, about ${fmt(hoursEarly, 1)}h before reset.`;
    elements.warning.hidden = false;
    elements.warning.textContent = `Current average pace would exhaust the weekly limit about ${fmt(hoursEarly, 1)} hours before the reset.`;
  } else {
    const projected = Math.max(0, stats.projectedRaw);
    elements.projectedUsed.textContent = `${fmt(projected, 1)}% used`;
    elements.projectedSub.textContent = `${fmt(Math.max(0, 100 - projected), 1)}% left if your average rate continues.`;
    elements.warning.hidden = true;
    elements.warning.textContent = "";
  }

  elements.updatedText.textContent = formatAge(usageData.lastUpdated || Date.now());
}

async function loadCached() {
  const stored = await chrome.storage.local.get(["usageData", "lastError"]);
  if (stored.usageData) {
    renderUsage(stored.usageData, stored.lastError || null);
  }
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add("spinning");

  try {
    const response = await chrome.runtime.sendMessage({ action: "refreshUsage" });
    if (response?.data) {
      renderUsage(response.data, response.ok ? null : response.error || "Refresh failed");
    } else if (!currentUsageData) {
      elements.loadingState.hidden = true;
      elements.errorState.hidden = false;
      elements.errorMessage.textContent = response?.error || "Could not load ChatGPT usage.";
    }
  } catch (error) {
    if (!currentUsageData) {
      elements.loadingState.hidden = true;
      elements.errorState.hidden = false;
      elements.errorMessage.textContent = error.message || String(error);
    }
  } finally {
    refreshInFlight = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.classList.remove("spinning");
  }
}

elements.refreshButton.addEventListener("click", refresh);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.usageData?.newValue) {
    const error = changes.lastError?.newValue || null;
    renderUsage(changes.usageData.newValue, error);
  } else if (changes.lastError && currentUsageData) {
    renderUsage(currentUsageData, changes.lastError.newValue || null);
  }
});

loadCached().finally(refresh);

setInterval(() => {
  if (currentUsageData) renderUsage(currentUsageData);
}, 1_000);

setInterval(refresh, REFRESH_INTERVAL_MS);
