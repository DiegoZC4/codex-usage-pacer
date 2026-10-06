(function installCreditHistoryCore(root, factory) {
  "use strict";
  const api = factory();
  root.CodexUsageCreditHistoryCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const DAY_MS = 86_400_000;
  const RANGES = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, all: Infinity };

  function observationsFromHistory(history) {
    const byTime = new Map();
    const add = (atMs, value) => {
      if (!Number.isFinite(atMs)) return;
      const count = Number.isFinite(value?.count) && value.count >= 0 ? value.count : null;
      byTime.set(atMs, { atMs, count });
    };
    for (const change of [...(history?.evidenceChanges || [])].sort((a, b) => a.detectedAtMs - b.detectedAtMs)) {
      if (change.entityType !== "credits") continue;
      add(change.previousCheckAtMs, change.oldValue);
      add(change.detectedAtMs, change.newValue);
    }
    add(history?.latestEvidence?.checkedAtMs, history?.latestEvidence?.credits);
    return [...byTime.values()].sort((a, b) => a.atMs - b.atMs);
  }

  function buildView(history, range = "24h", nowMs = Date.now()) {
    const observations = observationsFromHistory(history).filter((point) => point.atMs <= nowMs);
    const rangeMs = RANGES[range] ?? RANGES["24h"];
    const startAtMs = rangeMs === Infinity ? observations[0]?.atMs ?? nowMs : nowMs - rangeMs;
    const points = observations.filter((point) => point.atMs >= startAtMs);
    const validPoints = points.filter((point) => point.count !== null);
    const changes = validPoints.slice(1).map((to, index) => {
      const from = validPoints[index];
      return { from, to, delta: to.count - from.count };
    });
    const segments = [];
    let decline = 0;
    let increases = 0;
    let coveredMs = 0;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from.count === null || to.count === null) continue;
      const delta = to.count - from.count;
      const elapsedMs = to.atMs - from.atMs;
      segments.push({ from, to, delta, elapsedMs, stale: elapsedMs > 6 * 3_600_000 });
      decline += Math.max(0, -delta);
      increases += Math.max(0, delta);
      coveredMs += elapsedMs;
    }
    return {
      points, validPoints, segments, changes, startAtMs, endAtMs: nowMs,
      decline, increases, coveredMs,
      observedDecline: changes.reduce((sum, change) => sum + Math.max(0, -change.delta), 0),
      observedIncreases: changes.reduce((sum, change) => sum + Math.max(0, change.delta), 0),
      dailyDecline: coveredMs > 0 ? decline * DAY_MS / coveredMs : null,
      lastCheckedAtMs: observations.at(-1)?.atMs ?? null,
      // Boundary-crossing changes are deliberately not prorated into a range.
      statsStartAtMs: segments[0]?.from.atMs ?? null,
      statsEndAtMs: segments.at(-1)?.to.atMs ?? null,
    };
  }

  function yScale(points) {
    if (!points.length) return { min: 0, max: 1, ticks: [0, 1] };
    const counts = points.map((point) => point.count);
    let min = Math.min(...counts);
    let max = Math.max(...counts);
    if (max === min) {
      const padding = Math.max(1, max * 0.005);
      min = Math.max(0, min - padding);
      max += padding;
    }
    const roughStep = (max - min) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const step = ([1, 2, 5, 10].find((value) => value * magnitude >= roughStep) || 10) * magnitude;
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;
    const ticks = [];
    for (let value = min; value <= max + step / 10; value += step) ticks.push(Number(value.toPrecision(12)));
    return { min, max, ticks };
  }

  return { DAY_MS, RANGES, observationsFromHistory, buildView, yScale };
});
