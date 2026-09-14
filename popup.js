const WEEK_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_INTERVAL_MS = 30_000;
const SVG_NS = "http://www.w3.org/2000/svg";

const USAGE_CHART = {
  left: 42,
  right: 378,
  top: 16,
  bottom: 176,
  viewWidth: 390
};

const RATE_CHART = {
  left: 42,
  right: 378,
  top: 16,
  bottom: 176,
  viewWidth: 390
};

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

  usageChart: document.getElementById("usageChart"),
  idealPath: document.getElementById("idealPath"),
  unknownPath: document.getElementById("unknownPath"),
  actualPath: document.getElementById("actualPath"),
  projectionPath: document.getElementById("projectionPath"),
  currentPoint: document.getElementById("currentPoint"),
  nowGuide: document.getElementById("nowGuide"),
  changeMarkers: document.getElementById("changeMarkers"),
  usageHitArea: document.getElementById("usageHitArea"),
  usageHoverGuide: document.getElementById("usageHoverGuide"),
  usageTooltip: document.getElementById("usageTooltip"),
  chartStartLabel: document.getElementById("chartStartLabel"),
  chartNowLabel: document.getElementById("chartNowLabel"),
  chartResetLabel: document.getElementById("chartResetLabel"),
  historyNote: document.getElementById("historyNote"),

  rateChart: document.getElementById("rateChart"),
  ratePath: document.getElementById("ratePath"),
  rateCurrentPoint: document.getElementById("rateCurrentPoint"),
  evenRateLine: document.getElementById("evenRateLine"),
  rateHitArea: document.getElementById("rateHitArea"),
  rateHoverGuide: document.getElementById("rateHoverGuide"),
  rateTooltip: document.getElementById("rateTooltip"),
  rateTopLabel: document.getElementById("rateTopLabel"),
  rateMidLabel: document.getElementById("rateMidLabel"),
  rollingRateValue: document.getElementById("rollingRateValue"),
  peakRateValue: document.getElementById("peakRateValue"),
  rateStartLabel: document.getElementById("rateStartLabel"),
  rateWindowLabel: document.getElementById("rateWindowLabel"),
  rateEndLabel: document.getElementById("rateEndLabel"),
  rateNote: document.getElementById("rateNote")
};

let currentUsageData = null;
let usageHistory = [];
let currentError = null;
let refreshInFlight = false;
let rateWindowMinutes = 60;

let currentUsageSeries = [];
let currentRateSeries = [];
let currentUsageScale = null;
let currentRateScale = null;

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
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatShort(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
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

function linearPath(points) {
  if (!points.length) return "";
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(" ");
}

function stepPath(points) {
  if (!points.length) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    d += ` H ${point.x.toFixed(2)} V ${point.y.toFixed(2)}`;
  }

  return d;
}

function getRelevantHistory(stats) {
  const now = Date.now();
  const filtered = usageHistory
    .filter(
      (point) =>
        Number(point.resetAtMs) === Number(stats.resetAtMs) &&
        Number(point.ts) >= stats.startAtMs &&
        Number(point.ts) <= now &&
        Number.isFinite(Number(point.usedPct))
    )
    .map((point) => ({
      ts: Number(point.ts),
      usedPct: clamp(Number(point.usedPct), 0, 100)
    }))
    .sort((a, b) => a.ts - b.ts);

  const deduped = [];
  for (const point of filtered) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.ts - point.ts) < 1000) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }

  if (!deduped.length || now - deduped[deduped.length - 1].ts > 1000) {
    deduped.push({ ts: now, usedPct: stats.usedPct });
  } else {
    deduped[deduped.length - 1] = {
      ts: now,
      usedPct: stats.usedPct
    };
  }

  return deduped;
}

function getChangePoints(history) {
  const changes = [];
  for (const point of history) {
    const last = changes[changes.length - 1];
    if (!last || Math.abs(last.usedPct - point.usedPct) >= 0.0001) {
      changes.push({ ...point });
    } else {
      last.lastObservedTs = point.ts;
    }
  }
  return changes;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function renderChangeMarkers(changePoints, xFor, yFor) {
  clearChildren(elements.changeMarkers);

  const maxMarkers = 80;
  const stride = Math.max(1, Math.ceil(changePoints.length / maxMarkers));

  changePoints.forEach((point, index) => {
    if (
      index !== 0 &&
      index !== changePoints.length - 1 &&
      index % stride !== 0
    ) {
      return;
    }

    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", xFor(point.ts).toFixed(2));
    circle.setAttribute("cy", yFor(point.usedPct).toFixed(2));
    circle.setAttribute("r", index === changePoints.length - 1 ? "2.8" : "2");
    circle.setAttribute("class", "change-marker");
    elements.changeMarkers.appendChild(circle);
  });
}

function renderUsageChart(stats) {
  const { left, right, bottom } = USAGE_CHART;
  const width = right - left;
  const height = bottom - USAGE_CHART.top;
  const now = Date.now();

  const xFor = (timestamp) => {
    const fraction =
      (timestamp - stats.startAtMs) / (stats.resetAtMs - stats.startAtMs);
    return left + clamp(fraction, 0, 1) * width;
  };
  const yFor = (pct) => bottom - (clamp(pct, 0, 100) / 100) * height;

  currentUsageScale = { xFor, yFor, stats };

  elements.idealPath.setAttribute(
    "d",
    linearPath([
      { x: left, y: yFor(0) },
      { x: right, y: yFor(100) }
    ])
  );

  currentUsageSeries = getRelevantHistory(stats);
  const changePoints = getChangePoints(currentUsageSeries);

  const firstObserved = currentUsageSeries[0];
  if (firstObserved && firstObserved.ts > stats.startAtMs + 60_000) {
    elements.unknownPath.setAttribute(
      "d",
      linearPath([
        { x: left, y: yFor(0) },
        { x: xFor(firstObserved.ts), y: yFor(firstObserved.usedPct) }
      ])
    );
  } else {
    elements.unknownPath.setAttribute("d", "");
  }

  const observedSvgPoints = currentUsageSeries.map((point) => ({
    x: xFor(point.ts),
    y: yFor(point.usedPct)
  }));
  elements.actualPath.setAttribute("d", stepPath(observedSvgPoints));

  renderChangeMarkers(changePoints, xFor, yFor);

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

  elements.projectionPath.setAttribute(
    "d",
    linearPath([
      { x: currentX, y: currentY },
      { x: xFor(projectionEndTs), y: yFor(projectionEndPct) }
    ])
  );

  const distinctChanges = Math.max(0, changePoints.length - 1);
  elements.historyNote.textContent =
    `${currentUsageSeries.length} one-minute observations, ` +
    `${distinctChanges} detected usage changes. ` +
    `Hover the chart for exact readings.`;

  elements.chartStartLabel.textContent = formatShort(stats.startAtMs);
  elements.chartNowLabel.textContent = `${fmt(stats.elapsedPct, 1)}% through week`;
  elements.chartResetLabel.textContent = formatShort(stats.resetAtMs);
}

function findHistoryPointAtOrBefore(history, timestamp, startIndex = 0) {
  let index = startIndex;

  while (
    index + 1 < history.length &&
    history[index + 1].ts <= timestamp
  ) {
    index += 1;
  }

  return index;
}

function buildRateSeries(history, windowMinutes) {
  const windowMs = windowMinutes * 60_000;
  const minimumSpanMs = Math.min(windowMs * 0.7, 30 * 60_000);
  const rates = [];

  if (history.length < 2) return rates;

  let baselineIndex = 0;

  for (let i = 1; i < history.length; i += 1) {
    const current = history[i];
    const targetTs = current.ts - windowMs;

    baselineIndex = findHistoryPointAtOrBefore(
      history,
      targetTs,
      Math.min(baselineIndex, i - 1)
    );

    let baseline = history[baselineIndex];

    if (baseline.ts > targetTs) {
      baseline = history[0];
      if (current.ts - baseline.ts < minimumSpanMs) continue;
    } else if (baselineIndex + 1 < i) {
      const next = history[baselineIndex + 1];
      if (Math.abs(next.ts - targetTs) < Math.abs(baseline.ts - targetTs)) {
        baseline = next;
      }
    }

    const hours = (current.ts - baseline.ts) / 3_600_000;
    if (hours <= 0) continue;

    const delta = current.usedPct - baseline.usedPct;
    if (delta < -0.001) continue;

    rates.push({
      ts: current.ts,
      rate: Math.max(0, delta / hours),
      usedPct: current.usedPct
    });
  }

  return rates;
}

function niceRateMax(value) {
  const min = 0.25;
  const raw = Math.max(min, value);
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const normalized = raw / base;
  let nice;

  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 2.5) nice = 2.5;
  else if (normalized <= 5) nice = 5;
  else nice = 10;

  return nice * base;
}

function renderRateChart(stats) {
  currentRateSeries = buildRateSeries(currentUsageSeries, rateWindowMinutes);

  const { left, right, top, bottom } = RATE_CHART;
  const width = right - left;
  const height = bottom - top;

  if (!currentRateSeries.length) {
    elements.ratePath.setAttribute("d", "");
    elements.rateCurrentPoint.setAttribute("cx", "-100");
    elements.evenRateLine.setAttribute("y1", bottom);
    elements.evenRateLine.setAttribute("y2", bottom);
    elements.rateTopLabel.textContent = "—";
    elements.rateMidLabel.textContent = "—";
    elements.rollingRateValue.textContent = "Collecting…";
    elements.peakRateValue.textContent = "—";
    elements.rateStartLabel.textContent = "Observed start";
    elements.rateEndLabel.textContent = "Now";
    elements.rateWindowLabel.textContent = `${rateWindowMinutes < 60 ? `${rateWindowMinutes}m` : `${rateWindowMinutes / 60}h`} rolling`;
    elements.rateNote.textContent =
      "Not enough local history yet for this rolling window.";
    currentRateScale = null;
    return;
  }

  const domainStart = currentRateSeries[0].ts;
  const domainEnd = Math.max(
    currentRateSeries[currentRateSeries.length - 1].ts,
    domainStart + 60_000
  );

  const peakRate = Math.max(
    stats.evenRate,
    ...currentRateSeries.map((point) => point.rate)
  );
  const yMax = niceRateMax(peakRate * 1.12);

  const xFor = (timestamp) =>
    left + clamp((timestamp - domainStart) / (domainEnd - domainStart), 0, 1) * width;
  const yFor = (rate) =>
    bottom - (clamp(rate, 0, yMax) / yMax) * height;

  currentRateScale = { xFor, yFor, domainStart, domainEnd, yMax };

  const svgPoints = currentRateSeries.map((point) => ({
    x: xFor(point.ts),
    y: yFor(point.rate)
  }));
  elements.ratePath.setAttribute("d", linearPath(svgPoints));

  const last = currentRateSeries[currentRateSeries.length - 1];
  elements.rateCurrentPoint.setAttribute("cx", xFor(last.ts).toFixed(2));
  elements.rateCurrentPoint.setAttribute("cy", yFor(last.rate).toFixed(2));

  const evenY = yFor(stats.evenRate);
  elements.evenRateLine.setAttribute("y1", evenY.toFixed(2));
  elements.evenRateLine.setAttribute("y2", evenY.toFixed(2));

  elements.rateTopLabel.textContent = `${fmt(yMax, yMax < 1 ? 2 : 1)}`;
  elements.rateMidLabel.textContent = `${fmt(yMax / 2, yMax < 1 ? 2 : 1)}`;
  elements.rollingRateValue.textContent = `${fmt(last.rate, 3)}% / hr`;
  elements.peakRateValue.textContent = `${fmt(peakRate, 3)}% / hr`;
  elements.rateStartLabel.textContent = formatShort(domainStart);
  elements.rateEndLabel.textContent = formatTime(domainEnd);
  elements.rateWindowLabel.textContent =
    `${rateWindowMinutes < 60 ? `${rateWindowMinutes}m` : `${rateWindowMinutes / 60}h`} rolling`;

  elements.rateNote.textContent =
    `Rate = change in weekly usage over the selected rolling window. ` +
    `Dashed reference = even weekly pace (${fmt(stats.evenRate, 3)}% / hr).`;
}

function nearestByTimestamp(series, timestamp) {
  if (!series.length) return null;

  let lo = 0;
  let hi = series.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].ts < timestamp) lo = mid + 1;
    else hi = mid;
  }

  const right = series[lo];
  const left = series[Math.max(0, lo - 1)];

  return Math.abs(right.ts - timestamp) < Math.abs(left.ts - timestamp)
    ? right
    : left;
}

function pointerSvgX(event, svg, viewWidth) {
  const rect = svg.getBoundingClientRect();
  return ((event.clientX - rect.left) / rect.width) * viewWidth;
}

function positionTooltip(tooltip, event, chartWrap) {
  const rect = chartWrap.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const tooltipWidth = 160;

  tooltip.style.left = `${clamp(x + 10, 4, rect.width - tooltipWidth)}px`;
  tooltip.style.top = `${clamp(y - 42, 4, rect.height - 52)}px`;
}

function setupUsageTooltip() {
  const chartWrap = elements.usageChart.parentElement;

  elements.usageHitArea.addEventListener("pointermove", (event) => {
    if (!currentUsageScale || !currentUsageSeries.length) return;

    const x = pointerSvgX(event, elements.usageChart, USAGE_CHART.viewWidth);
    const fraction = clamp(
      (x - USAGE_CHART.left) / (USAGE_CHART.right - USAGE_CHART.left),
      0,
      1
    );
    const { stats } = currentUsageScale;
    const timestamp =
      stats.startAtMs + fraction * (stats.resetAtMs - stats.startAtMs);
    const point = nearestByTimestamp(currentUsageSeries, timestamp);
    if (!point) return;

    const guideX = currentUsageScale.xFor(point.ts);
    elements.usageHoverGuide.setAttribute("x1", guideX.toFixed(2));
    elements.usageHoverGuide.setAttribute("x2", guideX.toFixed(2));
    elements.usageHoverGuide.hidden = false;

    elements.usageTooltip.innerHTML =
      `<div class="tooltip-value">${fmt(point.usedPct, 2)}% used</div>` +
      `<div class="tooltip-time">${formatExact(point.ts)}</div>`;
    elements.usageTooltip.hidden = false;
    positionTooltip(elements.usageTooltip, event, chartWrap);
  });

  elements.usageHitArea.addEventListener("pointerleave", () => {
    elements.usageTooltip.hidden = true;
    elements.usageHoverGuide.hidden = true;
  });
}

function setupRateTooltip() {
  const chartWrap = elements.rateChart.parentElement;

  elements.rateHitArea.addEventListener("pointermove", (event) => {
    if (!currentRateScale || !currentRateSeries.length) return;

    const x = pointerSvgX(event, elements.rateChart, RATE_CHART.viewWidth);
    const fraction = clamp(
      (x - RATE_CHART.left) / (RATE_CHART.right - RATE_CHART.left),
      0,
      1
    );
    const timestamp =
      currentRateScale.domainStart +
      fraction * (currentRateScale.domainEnd - currentRateScale.domainStart);
    const point = nearestByTimestamp(currentRateSeries, timestamp);
    if (!point) return;

    const guideX = currentRateScale.xFor(point.ts);
    elements.rateHoverGuide.setAttribute("x1", guideX.toFixed(2));
    elements.rateHoverGuide.setAttribute("x2", guideX.toFixed(2));
    elements.rateHoverGuide.hidden = false;

    elements.rateTooltip.innerHTML =
      `<div class="tooltip-value">${fmt(point.rate, 3)}% / hr</div>` +
      `<div class="tooltip-time">${formatExact(point.ts)}</div>` +
      `<div class="tooltip-time">${fmt(point.usedPct, 2)}% cumulative used</div>`;
    elements.rateTooltip.hidden = false;
    positionTooltip(elements.rateTooltip, event, chartWrap);
  });

  elements.rateHitArea.addEventListener("pointerleave", () => {
    elements.rateTooltip.hidden = true;
    elements.rateHoverGuide.hidden = true;
  });
}

function renderUsage(usageData, errorMessage = currentError) {
  currentUsageData = usageData;
  currentError = errorMessage;
  const weekly = usageData?.weekly;

  if (!weekly) {
    elements.loadingState.hidden = true;
    elements.usageView.hidden = true;
    elements.errorState.hidden = false;
    elements.errorMessage.textContent =
      errorMessage || "No weekly usage data is available yet.";
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

  elements.resetCountdown.textContent =
    `Resets in ${formatCountdown(stats.resetAtMs - Date.now())}`;
  elements.resetExact.textContent = formatExact(stats.resetAtMs);

  elements.avgRate.textContent = `${fmt(stats.avgRate, 3)}% / hr`;
  elements.avgRateSub.textContent =
    `Even pace is ${fmt(stats.evenRate, 3)}% / hr`;

  elements.paceValue.textContent = pace.value;
  elements.paceSub.textContent = pace.sub;

  elements.safeRate.textContent = Number.isFinite(stats.safeRate)
    ? `${fmt(stats.safeRate, 3)}% / hr`
    : "—";

  if (stats.projectedRaw > 100 && Number.isFinite(stats.hoursUntilExhausted)) {
    const hoursEarly = Math.max(
      0,
      stats.remainingHours - stats.hoursUntilExhausted
    );
    elements.projectedUsed.textContent = "100% (hits early)";
    elements.projectedSub.textContent =
      `About ${fmt(hoursEarly, 1)}h before reset at the current average rate.`;
    elements.warning.hidden = false;
    elements.warning.textContent =
      `Current average pace would exhaust the weekly limit about ` +
      `${fmt(hoursEarly, 1)} hours before reset.`;
  } else {
    const projected = Math.max(0, stats.projectedRaw);
    const buffer = Math.max(0, 100 - projected);
    elements.projectedUsed.textContent = `${fmt(projected, 1)}% used`;
    elements.projectedSub.textContent =
      `${fmt(buffer, 1)}% projected buffer at reset.`;

    if (projected >= 95) {
      elements.warning.hidden = false;
      elements.warning.textContent =
        `Your current trajectory still makes the reset, but with only about ` +
        `${fmt(buffer, 1)}% of the weekly limit to spare.`;
    } else {
      elements.warning.hidden = true;
      elements.warning.textContent = "";
    }
  }

  renderUsageChart(stats);
  renderRateChart(stats);

  elements.updatedText.textContent =
    formatAge(usageData.lastUpdated || Date.now());
  elements.statusText.textContent = errorMessage ? "Cached" : "Live";
}

async function loadCached() {
  const stored = await chrome.storage.local.get([
    "usageData",
    "usageHistory",
    "lastError"
  ]);

  usageHistory = Array.isArray(stored.usageHistory)
    ? stored.usageHistory
    : [];
  currentError = stored.lastError || null;

  if (stored.usageData) {
    renderUsage(stored.usageData, currentError);
    return true;
  }

  elements.loadingState.hidden = false;
  return false;
}

async function refresh() {
  if (refreshInFlight) return;

  refreshInFlight = true;
  elements.refreshButton.disabled = true;
  elements.refreshButton.classList.add("spinning");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "refreshUsage"
    });

    if (response?.data) {
      renderUsage(
        response.data,
        response.ok ? null : response.error || "Refresh failed"
      );
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

document.querySelectorAll(".rate-window-button").forEach((button) => {
  button.addEventListener("click", () => {
    rateWindowMinutes = Number(button.dataset.window) || 60;

    document.querySelectorAll(".rate-window-button").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
    });

    if (currentUsageData?.weekly) {
      renderRateChart(calculate(currentUsageData.weekly));
    }
  });
});

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

setupUsageTooltip();
setupRateTooltip();

loadCached().finally(() => {
  requestAnimationFrame(() => {
    setTimeout(refresh, 120);
  });
});

setInterval(() => {
  if (currentUsageData) {
    const weekly = currentUsageData.weekly;
    elements.resetCountdown.textContent =
      `Resets in ${formatCountdown(Number(weekly.resetAtMs) - Date.now())}`;
    elements.updatedText.textContent =
      formatAge(currentUsageData.lastUpdated || Date.now());
  }
}, 1_000);

setInterval(refresh, REFRESH_INTERVAL_MS);
