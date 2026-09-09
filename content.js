(() => {
  const PANEL_ID = "cgpt-weekly-pace-panel";
  const WEEK_HOURS = 7 * 24;
  let lastSignature = null;

  function parseRemainingHours(text) {
    // Handles strings like:
    // "Resets in 5d 14h"
    // "Resets in 14h"
    // "Resets in 42m"
    // "Resets in 5d"
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    const daysMatch = normalized.match(/(\d+(?:\.\d+)?)\s*d(?:ay)?s?/i);
    const hoursMatch = normalized.match(/(\d+(?:\.\d+)?)\s*h(?:our)?s?/i);
    const minsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?)?s?/i);

    const days = daysMatch ? Number(daysMatch[1]) : 0;
    const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
    const mins = minsMatch ? Number(minsMatch[1]) : 0;

    const total = days * 24 + hours + mins / 60;
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  function findWeeklyLimitCard() {
    // We intentionally search by visible text instead of brittle class names,
    // because ChatGPT's generated CSS class names can change.
    const all = Array.from(document.querySelectorAll("body *"));

    const weeklyLabel = all.find((el) => {
      const t = el.textContent?.trim();
      return t === "Weekly limit" && el.children.length === 0;
    });

    if (!weeklyLabel) return null;

    // Walk upward until we find a compact container that also contains
    // both the reset text and "% left".
    let node = weeklyLabel.parentElement;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      const text = node.innerText || "";
      if (
        /Weekly limit/i.test(text) &&
        /Resets in/i.test(text) &&
        /\d+(?:\.\d+)?%\s*left/i.test(text)
      ) {
        return node;
      }
    }

    return null;
  }

  function extractUsage(card) {
    const text = card.innerText.replace(/\s+/g, " ").trim();

    const leftMatch = text.match(/(\d+(?:\.\d+)?)%\s*left/i);
    const resetMatch = text.match(/Resets in\s+([^%]+?)(?=\s+\d+(?:\.\d+)?%\s*left|$)/i);

    if (!leftMatch || !resetMatch) return null;

    const leftPct = Number(leftMatch[1]);
    const remainingHours = parseRemainingHours(resetMatch[1]);

    if (
      !Number.isFinite(leftPct) ||
      leftPct < 0 ||
      leftPct > 100 ||
      remainingHours === null
    ) {
      return null;
    }

    return { leftPct, remainingHours };
  }

  function fmt(value, digits = 2) {
    return Number(value).toFixed(digits);
  }

  function makeMetric(label, value, subtext = "") {
    const item = document.createElement("div");
    item.className = "cgpt-pace-metric";

    const labelEl = document.createElement("div");
    labelEl.className = "cgpt-pace-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "cgpt-pace-value";
    valueEl.textContent = value;

    item.append(labelEl, valueEl);

    if (subtext) {
      const subEl = document.createElement("div");
      subEl.className = "cgpt-pace-sub";
      subEl.textContent = subtext;
      item.appendChild(subEl);
    }

    return item;
  }

  function calculate(leftPct, remainingHours) {
    const usedPct = 100 - leftPct;
    const elapsedHours = Math.max(0, WEEK_HOURS - remainingHours);
    const elapsedPct = Math.min(100, Math.max(0, (elapsedHours / WEEK_HOURS) * 100));

    const avgRate = elapsedHours > 0 ? usedPct / elapsedHours : 0;
    const onPaceRate = 100 / WEEK_HOURS;
    const sustainableFromNow =
      remainingHours > 0 ? leftPct / remainingHours : Infinity;

    // Positive means the user has consumed more than the fraction of the
    // week that has elapsed; negative means they are under pace.
    const pacePoints = usedPct - elapsedPct;

    const relativePace =
      elapsedPct > 0 ? ((usedPct / elapsedPct) - 1) * 100 : 0;

    const projectedUsed = Math.min(
      100,
      Math.max(0, usedPct + avgRate * remainingHours)
    );

    const projectedLeft = Math.max(0, 100 - projectedUsed);

    const hoursUntilExhaustedAtCurrentRate =
      avgRate > 0 ? leftPct / avgRate : Infinity;

    return {
      usedPct,
      elapsedHours,
      elapsedPct,
      avgRate,
      onPaceRate,
      sustainableFromNow,
      pacePoints,
      relativePace,
      projectedUsed,
      projectedLeft,
      hoursUntilExhaustedAtCurrentRate
    };
  }

  function paceCopy(stats) {
    const absPts = Math.abs(stats.pacePoints);
    const absRel = Math.abs(stats.relativePace);

    if (Math.abs(stats.pacePoints) < 0.15) {
      return {
        headline: "On pace",
        detail: "Usage is almost exactly aligned with the weekly reset."
      };
    }

    if (stats.pacePoints > 0) {
      return {
        headline: `${fmt(absPts, 1)} pts over pace`,
        detail: `${fmt(absRel, 1)}% faster than an even weekly pace.`
      };
    }

    return {
      headline: `${fmt(absPts, 1)} pts under pace`,
      detail: `${fmt(absRel, 1)}% slower than an even weekly pace.`
    };
  }

  function render(card, data) {
    const stats = calculate(data.leftPct, data.remainingHours);
    const pace = paceCopy(stats);

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.className = "cgpt-weekly-pace-panel";
      card.insertAdjacentElement("afterend", panel);
    }

    panel.replaceChildren();

    const titleRow = document.createElement("div");
    titleRow.className = "cgpt-pace-title-row";

    const title = document.createElement("div");
    title.className = "cgpt-pace-title";
    title.textContent = "Weekly pace";

    const note = document.createElement("div");
    note.className = "cgpt-pace-note";
    note.textContent = "Estimated from ChatGPT's displayed reset countdown";

    titleRow.append(title, note);

    const grid = document.createElement("div");
    grid.className = "cgpt-pace-grid";

    grid.append(
      makeMetric(
        "Used",
        `${fmt(stats.usedPct, 1)}%`,
        `${fmt(data.leftPct, 1)}% remaining`
      ),
      makeMetric(
        "Avg. usage rate",
        `${fmt(stats.avgRate, 3)}% / hr`,
        `Even pace is ${fmt(stats.onPaceRate, 3)}% / hr`
      ),
      makeMetric(
        "Pace",
        pace.headline,
        pace.detail
      ),
      makeMetric(
        "Safe rate from now",
        `${fmt(stats.sustainableFromNow, 3)}% / hr`,
        "Average rate that would reach 100% exactly at reset"
      ),
      makeMetric(
        "Projected at reset",
        `${fmt(stats.projectedUsed, 1)}% used`,
        `${fmt(stats.projectedLeft, 1)}% left if your average rate continues`
      )
    );

    if (
      Number.isFinite(stats.hoursUntilExhaustedAtCurrentRate) &&
      stats.hoursUntilExhaustedAtCurrentRate < data.remainingHours
    ) {
      const warning = document.createElement("div");
      warning.className = "cgpt-pace-warning";
      warning.textContent =
        `At your current average rate, the weekly limit would be exhausted ` +
        `${fmt(data.remainingHours - stats.hoursUntilExhaustedAtCurrentRate, 1)} hours before reset.`;
      panel.append(titleRow, grid, warning);
    } else {
      panel.append(titleRow, grid);
    }
  }

  function update() {
    const card = findWeeklyLimitCard();
    if (!card) {
      document.getElementById(PANEL_ID)?.remove();
      lastSignature = null;
      return;
    }

    const data = extractUsage(card);
    if (!data) return;

    const signature = `${data.leftPct}|${data.remainingHours}`;
    const existingPanel = document.getElementById(PANEL_ID);

    // Avoid reacting forever to our own DOM mutations.
    if (signature === lastSignature && existingPanel) return;

    render(card, data);
    lastSignature = signature;
  }

  let scheduled = false;
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  // Initial render and occasional refresh in case the countdown changes
  // without a mutation we notice.
  update();
  setInterval(update, 30_000);
})();
