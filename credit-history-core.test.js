"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./credit-history-core.js");
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 2, 20);
const point = (hours, count) => ({ atMs: NOW + hours * HOUR, count });
function history(points) {
  return {
    evidenceChanges: points.slice(1).map((to, index) => ({
      entityType: "credits", previousCheckAtMs: points[index].atMs,
      detectedAtMs: to.atMs, oldValue: { count: points[index].count }, newValue: { count: to.count },
    })),
    latestEvidence: points.length ? { checkedAtMs: points.at(-1).atMs, credits: { count: points.at(-1).count } } : null,
  };
}

test("uses old and new observations, deduplicates timestamps and ignores quota changes", () => {
  const data = history([point(-3, 100), point(-2, 90), point(-1, 80)]);
  data.evidenceChanges.reverse();
  data.evidenceChanges.push({ entityType: "limit", detectedAtMs: NOW, newValue: { count: 999 } });
  assert.deepEqual(core.observationsFromHistory(data), [point(-3, 100), point(-2, 90), point(-1, 80)]);
});

test("keeps fractional balances, zero balances and unchanged intervals", () => {
  const view = core.buildView(history([point(-3, 0.75), point(-2, 0.75), point(-1, 0)]), "24h", NOW);
  assert.equal(view.decline, 0.75);
  assert.equal(view.coveredMs, 2 * HOUR);
  assert.equal(view.dailyDecline, 9);
});

test("separates grant increases from decreases without cancelling consumption", () => {
  const view = core.buildView(history([point(-24, 1000), point(-18, 900), point(-12, 1400), point(0, 1100)]), "24h", NOW);
  assert.equal(view.decline, 400);
  assert.equal(view.increases, 500);
  assert.equal(view.dailyDecline, 400);
});

test("missing and malformed balances break the trace and rate exposure", () => {
  const data = history([point(-6, 100), point(-5, null), point(-3, 50), point(-2, 40), point(-1, -1), point(0, 0)]);
  const view = core.buildView(data, "24h", NOW);
  assert.equal(view.segments.length, 1);
  assert.equal(view.coveredMs, HOUR);
  assert.equal(view.decline, 10);
  assert.equal(view.dailyDecline, 240);
  assert.equal(view.observedDecline, 100);
  assert.deepEqual(view.validPoints.map((p) => p.count), [100, 50, 40, 0]);
});

test("a grant across a missing-card interval remains an observed increase, not a continuous line", () => {
  const view = core.buildView(history([point(-24, 33431), point(-23, null), point(-2, 95931), point(0, 95000)]), "24h", NOW);
  assert.equal(view.observedIncreases, 62500);
  assert.equal(view.observedDecline, 931);
  assert.equal(view.segments.length, 1);
  assert.equal(view.changes[0].delta, 62500);
  assert.equal(view.coveredMs, 2 * HOUR);
});

test("does not turn numeric-looking strings into measured balances", () => {
  const view = core.buildView(history([point(-1, "100"), point(0, 80)]), "24h", NOW);
  assert.equal(view.validPoints.length, 1);
  assert.equal(view.dailyDecline, null);
});

test("does not prorate or charge a change that crosses a range boundary", () => {
  const view = core.buildView(history([point(-25, 1000), point(-23, 500), point(-1, 400)]), "24h", NOW);
  assert.equal(view.decline, 100);
  assert.equal(view.coveredMs, 22 * HOUR);
  assert.equal(view.statsStartAtMs, NOW - 23 * HOUR);
});

test("all history includes old data while shorter ranges are bounded", () => {
  const data = history([point(-1000, 100), point(-200, 90), point(-48, 80), point(-2, 70)]);
  assert.equal(core.buildView(data, "24h", NOW).validPoints.length, 1);
  assert.equal(core.buildView(data, "7d", NOW).validPoints.length, 2);
  assert.equal(core.buildView(data, "30d", NOW).validPoints.length, 3);
  assert.equal(core.buildView(data, "all", NOW).validPoints.length, 4);
});

test("one point has no invented rate or extrapolated observations", () => {
  const view = core.buildView(history([point(-2, 100)]), "24h", NOW);
  assert.equal(view.dailyDecline, null);
  assert.equal(view.segments.length, 0);
  assert.equal(view.lastCheckedAtMs, NOW - 2 * HOUR);
  assert.equal(view.validPoints.at(-1).atMs, NOW - 2 * HOUR);
});

test("unchanged balances yield a real zero decline", () => {
  const view = core.buildView(history([point(-10, 100), point(-1, 100)]), "24h", NOW);
  assert.equal(view.dailyDecline, 0);
  assert.equal(view.segments[0].stale, true);
});

test("future observations and invalid timestamps are omitted", () => {
  const data = history([point(-2, 100), point(1, 80)]);
  data.evidenceChanges.push({ entityType: "credits", detectedAtMs: NaN, newValue: { count: 70 } });
  const view = core.buildView(data, "24h", NOW);
  assert.deepEqual(view.validPoints, [point(-2, 100)]);
});

test("empty history and a range with no checks stay empty", () => {
  assert.equal(core.buildView(null, "24h", NOW).validPoints.length, 0);
  const view = core.buildView(history([point(-48, 100)]), "24h", NOW);
  assert.equal(view.validPoints.length, 0);
  assert.equal(view.dailyDecline, null);
  assert.equal(view.lastCheckedAtMs, NOW - 48 * HOUR);
});

test("y scale is finite and contains flat, zero, fractional, and large balances", () => {
  for (const values of [[0], [0.001, 0.002], [90000], [33500, 96000], [0, 1e8]]) {
    const scale = core.yScale(values.map((count) => ({ count })));
    assert.ok(Number.isFinite(scale.min) && Number.isFinite(scale.max));
    assert.ok(scale.max > scale.min);
    assert.ok(scale.min >= 0 && scale.min <= Math.min(...values));
    assert.ok(scale.max >= Math.max(...values));
    assert.ok(scale.ticks.length >= 2 && scale.ticks.length <= 7);
  }
});

test("graph calculations never mutate saved evidence", () => {
  const data = history([point(-20, 100), point(-10, 200), point(-1, 50)]);
  const saved = JSON.stringify(data);
  core.buildView(data, "24h", NOW);
  core.buildView(data, "all", NOW);
  assert.equal(JSON.stringify(data), saved);
});
