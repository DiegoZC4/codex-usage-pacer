"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GREEN_AT_MINUTES,
  MAX_USAGE_SAMPLES,
  MINUTE_MS,
  classifyUsageChange,
  normalizeState,
  processEvidenceObservation,
  processWeeklyObservation,
  shiftHue,
} = require("./reset-log-core.js");

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function observation(observedAtMs, predictedResetAtMs, options = {}) {
  const value = {
    observedAtMs,
    predictedResetAtMs,
    source: options.source || "reported",
    isFull: Boolean(options.isFull),
  };
  if (options.remainingPercent !== undefined) {
    value.remainingPercent = options.remainingPercent;
  }
  return value;
}

function startAt(resetAtMs, observedAtMs = 1_000_000) {
  return processWeeklyObservation(null, observation(observedAtMs, resetAtMs)).state;
}

function evidenceObservation(checkedAtMs, options = {}) {
  return {
    checkedAtMs,
    trigger: options.trigger || "initial",
    navigationType: options.navigationType || "navigate",
    outcome: options.outcome || "valid",
    extensionVersion: options.extensionVersion || "0.8.0",
    timezoneOffsetMinutes: 420,
    articleCount: options.articleCount ?? 3,
    candidateCardCount: options.candidateCardCount ?? 2,
    limitCount: options.limits?.length ?? 1,
    creditCardCount: options.credits ? 1 : 0,
    limits: options.limits || [
      {
        key: "weekly-usage-limit",
        label: "Weekly usage limit",
        remainingPercent: 98,
        remainingRaw: "98%",
        remainingPrecision: 0,
        reportedResetAtMs: 40 * DAY_MS,
        resetRaw: "Jul 30, 2026 2:00 PM",
        resetStatus: "reported",
        usedUnits: null,
        limitUnits: null,
        dataSource: "dom",
      },
    ],
    credits: options.credits || null,
  };
}

test("the first observation establishes a baseline without inventing history", () => {
  const resetAtMs = 30 * DAY_MS;
  const result = processWeeklyObservation(null, observation(10 * DAY_MS, resetAtMs));

  assert.equal(result.changed, true);
  assert.equal(result.event, null);
  assert.equal(result.state.events.length, 0);
  assert.equal(result.state.weekly.predictedResetAtMs, resetAtMs);
});

test("an unchanged reported reset does not write or log", () => {
  const resetAtMs = 30 * DAY_MS;
  const state = startAt(resetAtMs);
  const result = processWeeklyObservation(state, observation(2_000_000, resetAtMs));

  assert.equal(result.changed, false);
  assert.equal(result.state.events.length, 0);
});

test("a normal weekly rollover over 10,000 minutes is retained", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const newResetAtMs = oldResetAtMs + (GREEN_AT_MINUTES + 1) * MINUTE_MS;
  const result = processWeeklyObservation(state, observation(2_000_000, newResetAtMs));

  assert.equal(result.changed, true);
  assert.equal(result.event.forwardDeltaMinutes, GREEN_AT_MINUTES + 1);
  assert.equal(result.state.events.length, 1);
});

test("a forward shift under 10,000 minutes is retained", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const newResetAtMs = oldResetAtMs + 24 * HOUR_MS;
  const detectedAtMs = 12 * DAY_MS;
  const result = processWeeklyObservation(
    state,
    observation(detectedAtMs, newResetAtMs)
  );

  assert.equal(result.state.events.length, 1);
  assert.equal(result.event.detectedAtMs, detectedAtMs);
  assert.equal(result.event.oldResetAtMs, oldResetAtMs);
  assert.equal(result.event.newResetAtMs, newResetAtMs);
  assert.equal(result.event.forwardDeltaMinutes, 24 * 60);
});

test("a change records the remaining percentage observed with it", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const result = processWeeklyObservation(
    state,
    observation(12 * DAY_MS, oldResetAtMs + HOUR_MS, { remainingPercent: 41.5 })
  );

  assert.equal(result.event.remainingPercent, 41.5);
  assert.equal(result.state.events[0].remainingPercent, 41.5);
});

test("the first percentage observation records detection time and the exact remaining value", () => {
  const resetAtMs = 30 * DAY_MS;
  const detectedAtMs = 12 * DAY_MS;
  const result = processWeeklyObservation(
    null,
    observation(detectedAtMs, resetAtMs, { remainingPercent: 41.5 })
  );

  assert.deepEqual(result.sample, { detectedAtMs, remainingPercent: 41.5 });
  assert.deepEqual(result.state.usageSamples, [{ detectedAtMs, remainingPercent: 41.5 }]);
  assert.equal(Object.hasOwn(result.sample, "predictedResetAtMs"), false);
});

test("the same exact percentage does not add another sample or trigger a write", () => {
  const resetAtMs = 30 * DAY_MS;
  const first = processWeeklyObservation(
    null,
    observation(12 * DAY_MS, resetAtMs, { remainingPercent: 41.2 })
  );
  const repeated = processWeeklyObservation(
    first.state,
    observation(12 * DAY_MS + HOUR_MS, resetAtMs, { remainingPercent: 41.2 })
  );

  assert.equal(repeated.changed, false);
  assert.equal(repeated.sample, null);
  assert.equal(repeated.state.usageSamples.length, 1);
});

test("any different remaining value is persisted even when the rounded integer is unchanged", () => {
  const resetAtMs = 30 * DAY_MS;
  const first = processWeeklyObservation(
    null,
    observation(12 * DAY_MS, resetAtMs, { remainingPercent: 41.2 })
  );
  const detectedAtMs = 12 * DAY_MS + HOUR_MS;
  const changed = processWeeklyObservation(
    first.state,
    observation(detectedAtMs, resetAtMs, { remainingPercent: 41.4 })
  );

  assert.equal(changed.changed, true);
  assert.deepEqual(changed.sample, { detectedAtMs, remainingPercent: 41.4 });
  assert.equal(changed.state.usageSamples.length, 2);
});

test("normalization caps percentage history at the newest configured samples", () => {
  const usageSamples = Array.from({ length: MAX_USAGE_SAMPLES + 2 }, (_, index) => ({
    detectedAtMs: index,
    remainingPercent: index % 101,
  }));
  const state = normalizeState({ usageSamples });

  assert.equal(state.usageSamples.length, MAX_USAGE_SAMPLES);
  assert.equal(state.usageSamples[0].detectedAtMs, 2);
});

test("normalization migrates older integer percentage samples without losing them", () => {
  const state = normalizeState({
    usageSamples: [{ detectedAtMs: DAY_MS, remainingInt: 41 }],
  });

  assert.deepEqual(state.usageSamples, [
    { detectedAtMs: DAY_MS, remainingPercent: 41 },
  ]);
});

test("an invalid remaining percentage is omitted", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const result = processWeeklyObservation(
    state,
    observation(12 * DAY_MS, oldResetAtMs + HOUR_MS, { remainingPercent: 101 })
  );

  assert.equal(Object.hasOwn(result.event, "remainingPercent"), false);
  assert.equal(result.state.usageSamples.length, 0);
});

test("a backward reset-date change is retained", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const result = processWeeklyObservation(
    state,
    observation(2_000_000, oldResetAtMs - 8 * DAY_MS)
  );

  assert.equal(result.state.events.length, 1);
  assert.ok(result.event.forwardDeltaMinutes < 0);
});

test("entering a full provisional window logs one early reset and freezes the prediction", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const detectedAtMs = oldResetAtMs - 6 * DAY_MS;
  const provisionalResetAtMs = detectedAtMs + WEEK_MS;
  const enteredFull = processWeeklyObservation(
    state,
    observation(detectedAtMs, provisionalResetAtMs, { source: "provisional", isFull: true })
  );
  const repeated = processWeeklyObservation(
    enteredFull.state,
    observation(detectedAtMs + HOUR_MS, provisionalResetAtMs + HOUR_MS, {
      source: "provisional",
      isFull: true,
    })
  );

  assert.equal(enteredFull.state.events.length, 1);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.events.length, 1);
  assert.equal(repeated.state.weekly.predictedResetAtMs, provisionalResetAtMs);
});

test("the first reported timestamp after a provisional estimate is logged as another change", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const detectedAtMs = oldResetAtMs - 6 * DAY_MS;
  const provisionalResetAtMs = detectedAtMs + WEEK_MS;
  const enteredFull = processWeeklyObservation(
    state,
    observation(detectedAtMs, provisionalResetAtMs, { source: "provisional", isFull: true })
  );
  const reportedResetAtMs = provisionalResetAtMs + 30 * MINUTE_MS;
  const reported = processWeeklyObservation(
    enteredFull.state,
    observation(detectedAtMs + 30 * MINUTE_MS, reportedResetAtMs)
  );

  assert.equal(reported.state.events.length, 2);
  assert.equal(reported.event.oldResetAtMs, provisionalResetAtMs);
  assert.equal(reported.event.newResetAtMs, reportedResetAtMs);
  assert.equal(reported.event.source, "reported");
  assert.equal(reported.state.weekly.source, "reported");
  assert.equal(reported.state.weekly.isFull, false);
});

test("a normal transition into a full provisional window is retained", () => {
  const oldResetAtMs = 30 * DAY_MS;
  const state = startAt(oldResetAtMs);
  const detectedAtMs = oldResetAtMs + HOUR_MS;
  const provisionalResetAtMs = detectedAtMs + WEEK_MS;
  const result = processWeeklyObservation(
    state,
    observation(detectedAtMs, provisionalResetAtMs, { source: "provisional", isFull: true })
  );

  assert.ok((provisionalResetAtMs - oldResetAtMs) / MINUTE_MS > GREEN_AT_MINUTES);
  assert.equal(result.state.events.length, 1);
});

test("jump hue runs from red to green and caps at 10,000 minutes", () => {
  assert.equal(shiftHue(-500), 0);
  assert.equal(shiftHue(0), 0);
  assert.equal(shiftHue(GREEN_AT_MINUTES / 2), 60);
  assert.equal(shiftHue(GREEN_AT_MINUTES), 120);
  assert.equal(shiftHue(GREEN_AT_MINUTES * 2), 120);
});

test("every usage increase is classified without a minimum-size threshold", () => {
  const previous = { detectedAtMs: DAY_MS, remainingPercent: 40 };
  const current = { detectedAtMs: DAY_MS + HOUR_MS, remainingPercent: 40.1 };

  assert.deepEqual(classifyUsageChange(previous, current), {
    kind: "usage-increase",
    detectedAtMs: current.detectedAtMs,
    previousDetectedAtMs: previous.detectedAtMs,
    previousRemainingPercent: 40,
    remainingPercent: 40.1,
    deltaPoints: current.remainingPercent - previous.remainingPercent,
    elapsedMs: HOUR_MS,
    resetEventId: null,
  });
});

test("a simultaneous reset change is linked without changing the neutral usage label", () => {
  const previous = { detectedAtMs: DAY_MS, remainingPercent: 8 };
  const current = { detectedAtMs: DAY_MS + HOUR_MS, remainingPercent: 100 };
  const event = {
    id: "normal-rollover",
    detectedAtMs: current.detectedAtMs,
    forwardDeltaMinutes: GREEN_AT_MINUTES,
  };
  const change = classifyUsageChange(previous, current, [event]);

  assert.equal(change.kind, "usage-increase");
  assert.equal(change.resetEventId, event.id);
});

test("every usage decrease is classified without a time-window threshold", () => {
  const previous = { detectedAtMs: DAY_MS, remainingPercent: 40 };
  const current = {
    detectedAtMs: DAY_MS + 4 * HOUR_MS,
    remainingPercent: 39.9,
  };

  assert.equal(classifyUsageChange(previous, current).kind, "usage-decrease");
});

test("an unchanged usage value is not recorded as a transition", () => {
  const start = { detectedAtMs: DAY_MS, remainingPercent: 40 };
  assert.equal(
    classifyUsageChange(start, {
      detectedAtMs: DAY_MS + HOUR_MS,
      remainingPercent: 40,
    }),
    null
  );
});

test("the first evidence check establishes a raw baseline without inventing changes", () => {
  const result = processEvidenceObservation(
    null,
    evidenceObservation(12 * DAY_MS)
  );

  assert.equal(result.changed, true);
  assert.equal(result.changes.length, 0);
  assert.equal(result.state.observationChecks.length, 1);
  assert.equal(result.state.latestEvidence.limits[0].remainingRaw, "98%");
  assert.equal(result.state.latestEvidence.limits[0].remainingPrecision, 0);
});

test("an unchanged evidence check is retained as observation coverage", () => {
  const first = processEvidenceObservation(
    null,
    evidenceObservation(12 * DAY_MS)
  );
  const second = processEvidenceObservation(
    first.state,
    evidenceObservation(12 * DAY_MS + HOUR_MS, { trigger: "focus" })
  );

  assert.equal(second.state.observationChecks.length, 2);
  assert.equal(second.state.observationChecks[1].trigger, "focus");
  assert.equal(second.changes.length, 0);
});

test("a decimal usage change records raw values and the previous check bound", () => {
  const first = processEvidenceObservation(
    null,
    evidenceObservation(12 * DAY_MS)
  );
  const nextLimit = {
    ...first.state.latestEvidence.limits[0],
    remainingPercent: 97.5,
    remainingRaw: "97.5%",
    remainingPrecision: 1,
  };
  const detectedAtMs = 12 * DAY_MS + HOUR_MS;
  const second = processEvidenceObservation(
    first.state,
    evidenceObservation(detectedAtMs, { limits: [nextLimit] })
  );

  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0].previousCheckAtMs, 12 * DAY_MS);
  assert.deepEqual(second.changes[0].changedFields, [
    "remainingPercent",
    "remainingRaw",
    "remainingPrecision",
  ]);
  assert.equal(second.changes[0].oldValue.remainingRaw, "98%");
  assert.equal(second.changes[0].newValue.remainingRaw, "97.5%");
});

test("reported reset disappearance is logged instead of silently skipped", () => {
  const first = processEvidenceObservation(
    null,
    evidenceObservation(12 * DAY_MS)
  );
  const missingReset = {
    ...first.state.latestEvidence.limits[0],
    reportedResetAtMs: null,
    resetRaw: null,
    resetStatus: "missing",
  };
  const second = processEvidenceObservation(
    first.state,
    evidenceObservation(12 * DAY_MS + HOUR_MS, { limits: [missingReset] })
  );

  assert.equal(second.changes.length, 1);
  assert.deepEqual(second.changes[0].changedFields, [
    "reportedResetAtMs",
    "resetRaw",
    "resetStatus",
  ]);
});

test("quota-card and credit availability transitions are logged generically", () => {
  const credits = {
    count: 4,
    countRaw: "4",
    expiryRaw: ["1 reset expires Jul 31"],
    dataSource: "dom",
  };
  const first = processEvidenceObservation(
    null,
    evidenceObservation(12 * DAY_MS, { credits })
  );
  const second = processEvidenceObservation(
    first.state,
    evidenceObservation(12 * DAY_MS + HOUR_MS, {
      outcome: "no-usage-cards",
      articleCount: 0,
      candidateCardCount: 0,
      limits: [],
      credits: null,
    })
  );

  assert.equal(second.changes.length, 2);
  assert.deepEqual(
    second.changes.map((change) => [change.entityType, change.changedFields]),
    [
      ["limit", ["presence"]],
      ["credits", ["presence"]],
    ]
  );
});

test("weekly processing preserves the generic evidence and check history", () => {
  const evidence = processEvidenceObservation(
    null,
    evidenceObservation(12 * DAY_MS)
  );
  const weekly = processWeeklyObservation(
    evidence.state,
    observation(12 * DAY_MS, 40 * DAY_MS, { remainingPercent: 98 })
  );

  assert.equal(weekly.state.observationChecks.length, 1);
  assert.equal(weekly.state.latestEvidence.limits[0].remainingRaw, "98%");
});
