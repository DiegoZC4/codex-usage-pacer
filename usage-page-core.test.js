"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./usage-page-core.js");
const reset = require("./reset-log-core.js");
const manifest = require("./manifest.json");

test("pacing colors are green at the target, including an empty or full week", () => {
  for (const percent of [0, 1, 50, 99, 100]) assert.equal(core.pacingColor(percent, percent), "#22c55e");
  assert.equal(core.PACING_COLOR_LIMIT, 20);
});

test("pacing colors saturate at a 20-percentage-point surplus or deficit", () => {
  for (const remaining of [70, 80, 100]) assert.equal(core.pacingColor(remaining, 50), "#3b82f6");
  for (const remaining of [30, 20, 0]) assert.equal(core.pacingColor(remaining, 50), "#fb6b70");
});

test("pacing colors blend proportionally in both directions", () => {
  assert.equal(core.pacingColor(95, 99), "color-mix(in oklab, #22c55e, #fb6b70 20%)");
  assert.equal(core.pacingColor(99, 95), "color-mix(in oklab, #22c55e, #3b82f6 20%)");
  assert.equal(core.pacingColor(40, 50), "color-mix(in oklab, #22c55e, #fb6b70 50%)");
  assert.equal(core.pacingColor(60, 50), "color-mix(in oklab, #22c55e, #3b82f6 50%)");
});

test("pacing uses absolute percentage points without rounding or relative-target scaling", () => {
  assert.equal(core.pacingColor(95.5, 99.25), "color-mix(in oklab, #22c55e, #fb6b70 18.75%)");
  assert.equal(core.pacingColor(0, 4), core.pacingColor(95, 99));
  assert.equal(core.pacingColor(4, 0), core.pacingColor(99, 95));
  assert.notEqual(core.pacingColor(99.25, 99.5), core.pacingColor(99.5, 99.5));
});

test("missing or invalid percentages do not become misleading pacing colors", () => {
  for (const value of [null, undefined, NaN, Infinity, "95", -1, 101]) {
    assert.equal(core.pacingColor(value, 50), null);
    assert.equal(core.pacingColor(50, value), null);
  }
});

test("legacy and redesigned labels share stable evidence keys", () => {
  for (const text of ["Weekly usage limit59% remaining", "Weekly limit Resets in 5d 18h 59% left"]) {
    assert.equal(core.usageKind(text), "weekly");
    assert.equal(core.usageLabel(text), "Weekly usage limit");
    assert.equal(core.remainingRaw(text), "59%");
  }
  for (const text of ["5 hour usage limit", "5-hour limit"]) {
    assert.equal(core.usageKind(text), "five-hour");
    assert.equal(core.usageLabel(text), "5 hour usage limit");
  }
  assert.equal(core.usageKind("Usage limit resets"), null);
});

test("remaining parsing keeps decimal precision, including zero and 100", () => {
  for (const raw of ["0", "59.25", "99.50", "100"]) assert.equal(core.remainingRaw(`${raw}% left`), `${raw}%`);
  for (const text of ["1000% left", "unknown% left", "59% used", "Resets in 5d 18h"]) assert.equal(core.remainingRaw(text), "");
});

test("exact tooltip reset retains seconds and explicit timezone", () => {
  const raw = "Friday, October 9, 2026 at 2:13:29 PM PDT";
  const date = core.parseResetDate(raw, new Date("2026-10-03T12:00:00Z"));
  assert.equal(date.toISOString(), "2026-10-09T21:13:29.000Z");
  assert.equal(core.parseResetDate("Sunday, November 8, 2026 at 2:13:29 PM PST", new Date()).toISOString(), "2026-11-08T22:13:29.000Z");
  assert.equal(core.parseResetDate("Oct 9, 2026 2:13 PM", new Date()).getFullYear(), 2026);
});

test("rounded countdowns never become synthetic reported reset events", () => {
  for (const text of ["Resets in 5d 18h", "Resets in 3h 4m", "", "not a date"]) {
    assert.equal(core.parseResetDate(text, new Date()), null);
  }
});

test("old time-only reset advances to the next day when needed", () => {
  const now = new Date(2026, 9, 3, 19, 0);
  const date = core.parseResetDate("2:13 PM", now);
  assert.equal(date.getDate(), 4);
  assert.equal(date.getHours(), 14);
  assert.equal(core.parseResetDate("33:70 PM", now), null);
});

test("redesigned credits are spending balance, not banked resets", () => {
  for (const text of ["Credits remaining93,394", "93,394 credits remaining Current balance", "0 credits remaining", "1.5 credits remaining"]) {
    assert.equal(reset.isSpendingCreditText(text), true);
    assert.ok(Number.isFinite(reset.parseCreditBalance(text).count));
  }
  for (const text of ["Available 1 Full reset", "3 reset credits available", "Usage limit resets", "3 credits available"]) {
    assert.equal(reset.isSpendingCreditText(text), false);
  }
});

test("only the two supported routes are authorized, with both in the manifest", () => {
  for (const path of ["/settings/usage", "/settings/usage/", "/codex/cloud/settings/analytics"]) assert.equal(core.isUsagePath(path), true);
  for (const path of ["/", "/settings/billing", "/settings/usage-other"]) assert.equal(core.isUsagePath(path), false);
  assert.ok(manifest.content_scripts[0].matches.includes("https://chatgpt.com/settings/usage*"));
  assert.ok(manifest.content_scripts[0].js.indexOf("usage-page-core.js") < manifest.content_scripts[0].js.indexOf("content.js"));
});
