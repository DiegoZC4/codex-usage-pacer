(function installResetLogCore(root, factory) {
  "use strict";

  const api = factory();
  root.CodexUsageResetLogCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const SCHEMA_VERSION = 5;
  const MINUTE_MS = 60 * 1000;
  const GREEN_AT_MINUTES = 10_000;
  const GREEN_HUE_DEGREES = 120;
  const MAX_EVENTS = 20_000;
  const MAX_USAGE_SAMPLES = 20_000;
  const MAX_OBSERVATION_CHECKS = 20_000;
  const MAX_EVIDENCE_CHANGES = 20_000;

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isPercent(value) {
    return isFiniteNumber(value) && value >= 0 && value <= 100;
  }

  function normalizeText(value, maxLength = 500) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text ? text.slice(0, maxLength) : null;
  }

  function normalizeNullableNumber(value) {
    return isFiniteNumber(value) ? value : null;
  }

  function normalizeLimitEvidence(value) {
    if (!value || typeof value !== "object") return null;
    const key = normalizeText(value.key, 160);
    const label = normalizeText(value.label, 200);
    if (!key || !label) return null;

    const remainingPrecision = Number.isInteger(value.remainingPrecision)
      ? Math.max(0, Math.min(12, value.remainingPrecision))
      : null;
    const resetStatus = ["reported", "missing", "unparseable"].includes(value.resetStatus)
      ? value.resetStatus
      : "missing";

    return {
      key,
      label,
      remainingPercent: isPercent(value.remainingPercent)
        ? value.remainingPercent
        : null,
      remainingRaw: normalizeText(value.remainingRaw, 80),
      remainingPrecision,
      reportedResetAtMs: normalizeNullableNumber(value.reportedResetAtMs),
      resetRaw: normalizeText(value.resetRaw, 200),
      resetStatus,
      usedUnits: normalizeNullableNumber(value.usedUnits),
      limitUnits: normalizeNullableNumber(value.limitUnits),
      dataSource: value.dataSource === "api" ? "api" : "dom",
    };
  }

  function normalizeCreditsEvidence(value) {
    if (!value || typeof value !== "object") return null;
    const expiryRaw = Array.isArray(value.expiryRaw)
      ? value.expiryRaw
          .map((entry) => normalizeText(entry, 300))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    return {
      count: Number.isInteger(value.count) && value.count >= 0 ? value.count : null,
      countRaw: normalizeText(value.countRaw, 80),
      expiryRaw,
      dataSource: value.dataSource === "api" ? "api" : "dom",
    };
  }

  function normalizeEvidenceValue(entityType, value) {
    if (value === null) return null;
    return entityType === "credits"
      ? normalizeCreditsEvidence(value)
      : normalizeLimitEvidence(value);
  }

  function normalizeObservationCheck(value) {
    if (!value || typeof value !== "object" || !isFiniteNumber(value.checkedAtMs)) {
      return null;
    }
    return {
      checkedAtMs: value.checkedAtMs,
      trigger: normalizeText(value.trigger, 40) || "unknown",
      navigationType: normalizeText(value.navigationType, 40) || "unknown",
      outcome: normalizeText(value.outcome, 80) || "unknown",
      extensionVersion: normalizeText(value.extensionVersion, 40) || "unknown",
      timezoneOffsetMinutes: isFiniteNumber(value.timezoneOffsetMinutes)
        ? value.timezoneOffsetMinutes
        : null,
      articleCount: Number.isInteger(value.articleCount) && value.articleCount >= 0
        ? value.articleCount
        : 0,
      candidateCardCount:
        Number.isInteger(value.candidateCardCount) && value.candidateCardCount >= 0
          ? value.candidateCardCount
          : 0,
      limitCount: Number.isInteger(value.limitCount) && value.limitCount >= 0
        ? value.limitCount
        : 0,
      creditCardCount:
        Number.isInteger(value.creditCardCount) && value.creditCardCount >= 0
          ? value.creditCardCount
          : 0,
    };
  }

  function normalizeEvidenceSnapshot(value) {
    if (!value || typeof value !== "object" || !isFiniteNumber(value.checkedAtMs)) {
      return null;
    }
    const seen = new Set();
    const limits = Array.isArray(value.limits)
      ? value.limits
          .map(normalizeLimitEvidence)
          .filter((limit) => {
            if (!limit || seen.has(limit.key)) return false;
            seen.add(limit.key);
            return true;
          })
      : [];
    return {
      checkedAtMs: value.checkedAtMs,
      limits,
      credits: normalizeCreditsEvidence(value.credits),
    };
  }

  function normalizeEvidenceChange(value) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "string" ||
      !isFiniteNumber(value.detectedAtMs) ||
      !isFiniteNumber(value.previousCheckAtMs)
    ) {
      return null;
    }
    const entityType = value.entityType === "credits" ? "credits" : "limit";
    const entityKey = normalizeText(value.entityKey, 160);
    const label = normalizeText(value.label, 200);
    const changedFields = Array.isArray(value.changedFields)
      ? value.changedFields
          .map((field) => normalizeText(field, 80))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    if (!entityKey || !label || !changedFields.length) return null;

    return {
      id: value.id,
      detectedAtMs: value.detectedAtMs,
      previousCheckAtMs: value.previousCheckAtMs,
      entityType,
      entityKey,
      label,
      changedFields,
      oldValue: normalizeEvidenceValue(entityType, value.oldValue),
      newValue: normalizeEvidenceValue(entityType, value.newValue),
      extensionVersion: normalizeText(value.extensionVersion, 40) || "unknown",
    };
  }

  function normalizeEvent(value) {
    if (!value || typeof value !== "object") return null;
    if (
      typeof value.id !== "string" ||
      !isFiniteNumber(value.detectedAtMs) ||
      !isFiniteNumber(value.oldResetAtMs) ||
      !isFiniteNumber(value.newResetAtMs) ||
      !isFiniteNumber(value.forwardDeltaMinutes)
    ) {
      return null;
    }

    const event = {
      id: value.id,
      detectedAtMs: value.detectedAtMs,
      oldResetAtMs: value.oldResetAtMs,
      newResetAtMs: value.newResetAtMs,
      forwardDeltaMinutes: value.forwardDeltaMinutes,
      source: value.source === "reported" ? "reported" : "provisional",
    };
    if (isFiniteNumber(value.reportedResetAtMs)) {
      event.reportedResetAtMs = value.reportedResetAtMs;
    }
    if (isPercent(value.remainingPercent)) {
      event.remainingPercent = value.remainingPercent;
    }
    return event;
  }

  function normalizeWeekly(value) {
    if (!value || typeof value !== "object" || !isFiniteNumber(value.predictedResetAtMs)) {
      return null;
    }

    return {
      predictedResetAtMs: value.predictedResetAtMs,
      source: value.source === "reported" ? "reported" : "provisional",
      isFull: Boolean(value.isFull),
      observedAtMs: isFiniteNumber(value.observedAtMs) ? value.observedAtMs : 0,
      rolloverFromResetAtMs: isFiniteNumber(value.rolloverFromResetAtMs)
        ? value.rolloverFromResetAtMs
        : null,
      rolloverEventId: typeof value.rolloverEventId === "string" ? value.rolloverEventId : null,
    };
  }

  function normalizeUsageSample(value) {
    if (!value || typeof value !== "object" || !isFiniteNumber(value.detectedAtMs)) return null;

    const remainingPercent = isPercent(value.remainingPercent)
      ? value.remainingPercent
      : isPercent(value.remainingInt)
        ? value.remainingInt
        : null;
    if (remainingPercent === null) return null;

    return {
      detectedAtMs: value.detectedAtMs,
      remainingPercent,
    };
  }

  function normalizeState(value) {
    const input = value && typeof value === "object" ? value : {};
    const events = Array.isArray(input.events)
      ? input.events.map(normalizeEvent).filter(Boolean).slice(-MAX_EVENTS)
      : [];
    const usageSamples = Array.isArray(input.usageSamples)
      ? input.usageSamples
          .map(normalizeUsageSample)
          .filter(Boolean)
          .slice(-MAX_USAGE_SAMPLES)
      : [];
    const observationChecks = Array.isArray(input.observationChecks)
      ? input.observationChecks
          .map(normalizeObservationCheck)
          .filter(Boolean)
          .slice(-MAX_OBSERVATION_CHECKS)
      : [];
    const evidenceChanges = Array.isArray(input.evidenceChanges)
      ? input.evidenceChanges
          .map(normalizeEvidenceChange)
          .filter(Boolean)
          .slice(-MAX_EVIDENCE_CHANGES)
      : [];

    return {
      version: SCHEMA_VERSION,
      startedAtMs: isFiniteNumber(input.startedAtMs) ? input.startedAtMs : 0,
      weekly: normalizeWeekly(input.weekly),
      events,
      usageSamples,
      observationChecks,
      evidenceChanges,
      latestEvidence: normalizeEvidenceSnapshot(input.latestEvidence),
    };
  }

  function normalizeObservation(value) {
    if (!value || typeof value !== "object") return null;
    if (!isFiniteNumber(value.observedAtMs) || !isFiniteNumber(value.predictedResetAtMs)) {
      return null;
    }

    const observation = {
      observedAtMs: value.observedAtMs,
      predictedResetAtMs: value.predictedResetAtMs,
      source: value.source === "reported" ? "reported" : "provisional",
      isFull: Boolean(value.isFull),
    };
    if (isPercent(value.remainingPercent)) {
      observation.remainingPercent = value.remainingPercent;
    }
    return observation;
  }

  function makeWeekly(observation, rolloverFromResetAtMs = null, rolloverEventId = null) {
    return {
      predictedResetAtMs: observation.predictedResetAtMs,
      source: observation.source,
      isFull: observation.isFull,
      observedAtMs: observation.observedAtMs,
      rolloverFromResetAtMs,
      rolloverEventId,
    };
  }

  function makeEvent(oldResetAtMs, observation) {
    const forwardDeltaMinutes =
      (observation.predictedResetAtMs - oldResetAtMs) / MINUTE_MS;
    const event = {
      id: [
        Math.trunc(observation.observedAtMs),
        Math.trunc(oldResetAtMs),
        Math.trunc(observation.predictedResetAtMs),
      ].join(":"),
      detectedAtMs: observation.observedAtMs,
      oldResetAtMs,
      newResetAtMs: observation.predictedResetAtMs,
      forwardDeltaMinutes,
      source: observation.source,
    };
    if (isPercent(observation.remainingPercent)) {
      event.remainingPercent = observation.remainingPercent;
    }
    return event;
  }

  function shiftHue(forwardDeltaMinutes, greenAtMinutes = GREEN_AT_MINUTES) {
    if (!isFiniteNumber(forwardDeltaMinutes) || !isFiniteNumber(greenAtMinutes) || greenAtMinutes <= 0) {
      return 0;
    }
    const progress = Math.max(0, Math.min(1, forwardDeltaMinutes / greenAtMinutes));
    return Math.round(progress * GREEN_HUE_DEGREES);
  }

  function classifyUsageChange(previousValue, currentValue, resetEvents = []) {
    const previous = normalizeUsageSample(previousValue);
    const current = normalizeUsageSample(currentValue);
    if (!previous || !current || current.detectedAtMs <= previous.detectedAtMs) return null;

    const deltaPoints = current.remainingPercent - previous.remainingPercent;
    if (deltaPoints === 0) return null;

    const elapsedMs = current.detectedAtMs - previous.detectedAtMs;
    const matchingReset = Array.isArray(resetEvents)
      ? resetEvents.find(
          (event) =>
            event &&
            event.detectedAtMs === current.detectedAtMs &&
            isFiniteNumber(event.forwardDeltaMinutes)
        )
      : null;

    return {
      kind: deltaPoints > 0 ? "usage-increase" : "usage-decrease",
      detectedAtMs: current.detectedAtMs,
      previousDetectedAtMs: previous.detectedAtMs,
      previousRemainingPercent: previous.remainingPercent,
      remainingPercent: current.remainingPercent,
      deltaPoints,
      elapsedMs,
      resetEventId: typeof matchingReset?.id === "string" ? matchingReset.id : null,
    };
  }

  function maybeAppendChangeEvent(state, oldResetAtMs, observation) {
    if (observation.predictedResetAtMs === oldResetAtMs) return null;

    const event = makeEvent(oldResetAtMs, observation);
    if (state.events.some((existing) => existing.id === event.id)) return null;

    state.events.push(event);
    state.events = state.events.slice(-MAX_EVENTS);
    return event;
  }

  function maybeAppendUsageSample(state, observation) {
    if (!isPercent(observation.remainingPercent)) return null;

    const sample = {
      detectedAtMs: observation.observedAtMs,
      remainingPercent: observation.remainingPercent,
    };
    const previous = state.usageSamples[state.usageSamples.length - 1];
    if (previous?.remainingPercent === sample.remainingPercent) return null;

    state.usageSamples.push(sample);
    state.usageSamples = state.usageSamples.slice(-MAX_USAGE_SAMPLES);
    return sample;
  }

  function normalizeEvidenceObservation(value) {
    const check = normalizeObservationCheck(value);
    const snapshot = normalizeEvidenceSnapshot({
      checkedAtMs: value?.checkedAtMs,
      limits: value?.limits,
      credits: value?.credits,
    });
    if (!check || !snapshot) return null;
    return {
      ...check,
      limits: snapshot.limits,
      credits: snapshot.credits,
    };
  }

  function valuesEqual(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
      return JSON.stringify(left || []) === JSON.stringify(right || []);
    }
    return left === right;
  }

  function evidenceChangedFields(entityType, oldValue, newValue) {
    if (!oldValue && !newValue) return [];
    if (!oldValue || !newValue) return ["presence"];

    const fields = entityType === "credits"
      ? ["count", "countRaw", "expiryRaw", "dataSource"]
      : [
          "label",
          "remainingPercent",
          "remainingRaw",
          "remainingPrecision",
          "reportedResetAtMs",
          "resetRaw",
          "resetStatus",
          "usedUnits",
          "limitUnits",
          "dataSource",
        ];
    return fields.filter((field) => !valuesEqual(oldValue[field], newValue[field]));
  }

  function appendEvidenceChange(
    state,
    observation,
    previousCheckAtMs,
    entityType,
    entityKey,
    oldValue,
    newValue
  ) {
    const changedFields = evidenceChangedFields(entityType, oldValue, newValue);
    if (!changedFields.length) return null;

    const label = newValue?.label || oldValue?.label || "Credits";
    const event = {
      id: [
        Math.trunc(observation.checkedAtMs),
        entityType,
        entityKey,
      ].join(":"),
      detectedAtMs: observation.checkedAtMs,
      previousCheckAtMs,
      entityType,
      entityKey,
      label,
      changedFields,
      oldValue,
      newValue,
      extensionVersion: observation.extensionVersion,
    };
    if (state.evidenceChanges.some((existing) => existing.id === event.id)) return null;

    state.evidenceChanges.push(event);
    state.evidenceChanges = state.evidenceChanges.slice(-MAX_EVIDENCE_CHANGES);
    return event;
  }

  function processEvidenceObservation(value, rawObservation) {
    const state = normalizeState(value);
    const observation = normalizeEvidenceObservation(rawObservation);
    if (!observation) {
      return { state, changed: false, changes: [] };
    }

    const check = normalizeObservationCheck(observation);
    const previousCheck = state.observationChecks[state.observationChecks.length - 1];
    if (!previousCheck || previousCheck.checkedAtMs !== check.checkedAtMs) {
      state.observationChecks.push(check);
      state.observationChecks = state.observationChecks.slice(-MAX_OBSERVATION_CHECKS);
    }

    const previous = state.latestEvidence;
    const nextSnapshot = {
      checkedAtMs: observation.checkedAtMs,
      limits: observation.limits,
      credits: observation.credits,
    };
    if (!previous) {
      state.latestEvidence = nextSnapshot;
      return { state, changed: true, changes: [] };
    }

    const changes = [];
    const oldLimits = new Map(previous.limits.map((limit) => [limit.key, limit]));
    const newLimits = new Map(observation.limits.map((limit) => [limit.key, limit]));
    const limitKeys = new Set([...oldLimits.keys(), ...newLimits.keys()]);
    for (const key of limitKeys) {
      const change = appendEvidenceChange(
        state,
        observation,
        previous.checkedAtMs,
        "limit",
        key,
        oldLimits.get(key) || null,
        newLimits.get(key) || null
      );
      if (change) changes.push(change);
    }

    const creditChange = appendEvidenceChange(
      state,
      observation,
      previous.checkedAtMs,
      "credits",
      "credits",
      previous.credits,
      observation.credits
    );
    if (creditChange) changes.push(creditChange);

    state.latestEvidence = nextSnapshot;
    return { state, changed: true, changes };
  }

  function processWeeklyObservation(value, rawObservation) {
    const state = normalizeState(value);
    const observation = normalizeObservation(rawObservation);
    if (!observation) {
      return { state, changed: false, event: null, sample: null };
    }

    if (!state.startedAtMs) state.startedAtMs = observation.observedAtMs;
    const sample = maybeAppendUsageSample(state, observation);
    const previous = state.weekly;
    if (!previous) {
      state.weekly = makeWeekly(observation);
      return { state, changed: true, event: null, sample };
    }

    if (observation.isFull) {
      if (previous.isFull) {
        return { state, changed: Boolean(sample), event: null, sample };
      }

      const event = maybeAppendChangeEvent(state, previous.predictedResetAtMs, observation);
      state.weekly = makeWeekly(
        observation,
        previous.predictedResetAtMs,
        event ? event.id : null
      );
      return { state, changed: true, event, sample };
    }

    if (previous.isFull) {
      const event = maybeAppendChangeEvent(
        state,
        previous.predictedResetAtMs,
        observation
      );
      state.weekly = makeWeekly(observation);
      return { state, changed: true, event, sample };
    }

    if (observation.predictedResetAtMs === previous.predictedResetAtMs) {
      return { state, changed: Boolean(sample), event: null, sample };
    }

    const event = maybeAppendChangeEvent(state, previous.predictedResetAtMs, observation);
    state.weekly = makeWeekly(observation);
    return { state, changed: true, event, sample };
  }

  return {
    GREEN_AT_MINUTES,
    MAX_EVIDENCE_CHANGES,
    MAX_OBSERVATION_CHECKS,
    MAX_USAGE_SAMPLES,
    MINUTE_MS,
    classifyUsageChange,
    classifyUsageJump: classifyUsageChange,
    normalizeState,
    processEvidenceObservation,
    processWeeklyObservation,
    shiftHue,
  };
});
