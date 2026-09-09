const WEEK_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_INTERVAL_MS = 30_000;
const SVG = "http://www.w3.org/2000/svg";

const elements = {
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  errorMessage: document.getElementById("errorMessage"),
  usageView: document.getElementById("usageView"),
  refreshButton: document.getElementById("refreshButton"),
  usedPct: document.getElementById("usedPct"),
  leftPct: document.getElementById("leftPct"),
  statusBadge: document.getElementById("statusBadge"),
  progressFill: document.getElementById("progressFill"),
  targetMarker: document.getElementById("targetMarker"),
  targetLabel: document.getElementById("targetLabel"),
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
  updatedText: document.getElementById("updatedText"),
  statusText: document.getElementById("statusText"),
  idealPath: document.getElementById("idealPath"),
  actualPath: document.getElementById("actualPath"),
  projectionPath: document.getElementById("projectionPath"),
  currentPoint: document.getElementById("currentPoint"),
  nowGuide: document.getElementById("nowGuide"),
  chartNowLabel: document.getElementById("chartNowLabel"),
  historyNote: document.getElementById("historyNote")
};

let currentUsageData = null;
let usageHistory = [];
let currentError = null;
let refreshInFlight = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
  const usedPct = clamp(Number(weekly.usedPct), 0, 100);
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
    resetAtMs,
    startAtMs,
    windowSeconds
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

function statusFor(stats) {
  if (stats.projectedRaw > 100) {
    return { className: "status-bad", label: "Hits limit early" };
  }
  if (stats.projectedRaw >= 95) {
    return { className: "status-warn", label: "Close to limit" };
  }
  return { className: "status-good", label: "On track" };
}

function setStatus(status) {
  document.body.classList.remove("status-good", "status-warn", "status-bad");
  document.body.classList.add(status.className);
  elements.statusBadge.textContent = status.label;
}

function makePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function renderChart(stats) {
  const left = 36;
  const right = 348;
  const top = 14;
  const bottom = 154;
  const width = right - left;
  const height = bottom - top;
  const now = Date.now();

  const xFor = (timestamp) => {
    const fraction = (timestamp - stats.startAtMs) / (stats.resetAtMs - stats.startAtMs);
    return left + clamp(fraction, 0, 1) * width;
  };
  const yFor = (pct) => bottom - clamp(pct, 0, 100) / 100 * height;

  elements.idealPath.setAttribute("d", makePath([
    { x: left, y: yFor(0) },
    { x: right, y: yFor(100) }
  ]));

  const relevantHistory = usageHistory
    .filter((point) =>
      Number(point.resetAtMs) === Number(stats.resetAtMs) &&
      Number(point.ts) >= stats.startAtMs &&
      Number(point.ts) <= now &&
      Number.isFinite(Number(point.usedPct))
    )
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  const rawActual = [
    { ts: stats.startAtMs, usedPct: 0 },
    ...relevantHistory,
    { ts: now, usedPct: stats.usedPct }
  ];

  const deduped = [];
  for (const point of rawActual) {
    const normalized = {
      ts: Number(point.ts),
      usedPct: clamp(Number(point.usedPct), 0, 100)
    };
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.ts - normalized.ts) < 1000) {
      deduped[deduped.length - 1] = normalized;
    } else {
      deduped.push(normalized);
    }
  }

  elements.actualPath.setAttribute("d", makePath(
    deduped.map((point) => ({ x: xFor(point.ts), y: yFor(point.usedPct) }))
  ));

  const currentX = xFor(now);
  const currentY = yFor(stats.usedPct);
  elements.currentPoint.setAttribute("cx", currentX.toFixed(2));
  elements.currentPoint.setAttribute("cy", currentY.toFixed(2));
  elements.nowGuide.setAttribute("x1", currentX.toFixed(2));
  elements.nowGuide.setAttribute("x2", currentX.toFixed(2));

  let projectionEndTs = stats.resetAtMs;
  let projectionEndPct = stats.projectedRaw;

  if (stats.projectedRaw > 100 && Number.isFinite(stats.hoursUntilExhausted)) {
    projectionEndTs = Math.min(
      stats.resetAtMs,
      now + stats.hoursUntilExhausted * 3_600_000
    );
    projectionEndPct = 100;
  }

  elements.projectionPath.setAttribute("d", makePath([
    { x: currentX, y: currentY },
    { x: xFor(projectionEndTs), y: yFor(projectionEndPct) }
  ]));

  const observedCount = relevantHistory.length;
  elements.historyNote.textContent = observedCount >= 2
    ? `${observedCount} locally observed usage snapshots in this weekly window.`
    : "History starts building locally now; the first segment is an average from the weekly reset to your first observed point.";

  elements.chartNowLabel.textContent = `${fmt(stats.elapsedPct, 0)}% through week`;
}

function renderUsage(usageData, errorMessage = currentError) {
  currentUsageData = usageData;
  currentError = errorMessage;
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
  const status = statusFor(stats);
  setStatus(status);

  elements.loadingState.hidden = true;
  elements.usageView.hidden = false;
  elements.errorState.hidden = !errorMessage;
  elements.errorMessage.textContent = errorMessage || "";

  elements.usedPct.textContent = `${fmt(stats.usedPct, 1)}%`;
  elements.leftPct.textContent = `${fmt(stats.leftPct, 1)}% left`;
  elements.progressFill.style.width = `${stats.usedPct}%`;

  elements.targetMarker.style.left = `${clamp(stats.elapsedPct, 0, 100)}%`;
  elements.targetLabel.style.left = `${clamp(stats.elapsedPct, 9, 91)}%`;
  elements.targetLabel.textContent = `Even pace: ${fmt(stats.elapsedPct, 1)}% by now`;

  elements.resetCountdown.textContent = `Resets in ${formatCountdown(stats.resetAtMs - Date.now())}`;
  elements.resetExact.textContent = formatExact(stats.resetAtMs);

  elements.avgRate.textContent = `${fmt(stats.avgRate, 3)}% / hr`;
  elements.avgRateSub.textContent = `Even pace is ${fmt(stats.evenRate, 3)}% / hr`;

  elements.paceValue.textContent = pace.value;
  elements.paceSub.textContent = pace.sub;

  elements.safeRate.textContent = Number.isFinite(stats.safeRate)
    ? `${fmt(stats.safeRate, 3)}% / hr`
    : "—";

  if (stats.projectedRaw > 100 && Number.isFinite(stats.hoursUntilExhausted)) {
    const hoursEarly = Math.max(0, stats.remainingHours - stats.hoursUntilExhausted);
    elements.projectedUsed.textContent = "100% (hits early)";
    elements.projectedSub.textContent = `About ${fmt(hoursEarly, 1)}h before reset at the current average rate.`;
    elements.warning.hidden = false;
    elements.warning.textContent = `Current average pace would exhaust the weekly limit about ${fmt(hoursEarly, 1)} hours before reset.`;
  } else {
    const projected = Math.max(0, stats.projectedRaw);
    const buffer = Math.max(0, 100 - projected);
    elements.projectedUsed.textContent = `${fmt(projected, 1)}% used`;
    elements.projectedSub.textContent = `${fmt(buffer, 1)}% projected buffer at reset.`;

    if (projected >= 95) {
      elements.warning.hidden = false;
      elements.warning.textContent = `Your current trajectory still makes the reset, but with only about ${fmt(buffer, 1)}% of the weekly limit to spare.`;
    } else {
      elements.warning.hidden = true;
      elements.warning.textContent = "";
    }
  }

  renderChart(stats);
  elements.updatedText.textContent = formatAge(usageData.lastUpdated || Date.now());
  elements.statusText.textContent = errorMessage ? "Cached" : "Live";
}

async function loadCached() {
  const stored = await chrome.storage.local.get(["usageData", "usageHistory", "lastError"]);
  usageHistory = Array.isArray(stored.usageHistory) ? stored.usageHistory : [];
  currentError = stored.lastError || null;

  if (stored.usageData) {
    renderUsage(stored.usageData, currentError);
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
      currentError = response?.error || "Could not load ChatGPT usage.";
      elements.loadingState.hidden = true;
      elements.errorState.hidden = false;
      elements.errorMessage.textContent = currentError;
    }
  } catch (error) {
    currentError = error.message || String(error);
    if (!currentUsageData) {
      elements.loadingState.hidden = true;
      elements.errorState.hidden = false;
      elements.errorMessage.textContent = currentError;
    } else {
      renderUsage(currentUsageData, currentError);
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

  if (changes.usageHistory) {
    usageHistory = Array.isArray(changes.usageHistory.newValue)
      ? changes.usageHistory.newValue
      : [];
  }

  if (changes.lastError) {
    currentError = changes.lastError.newValue || null;
  }

  if (changes.usageData?.newValue) {
    renderUsage(changes.usageData.newValue, currentError);
  } else if ((changes.usageHistory || changes.lastError) && currentUsageData) {
    renderUsage(currentUsageData, currentError);
  }
});

loadCached().finally(refresh);

setInterval(() => {
  if (currentUsageData) renderUsage(currentUsageData, currentError);
}, 1_000);

setInterval(refresh, REFRESH_INTERVAL_MS);
