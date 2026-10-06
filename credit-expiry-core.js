(function installCreditExpiryCore(root, factory) {
  "use strict";
  const api = factory();
  root.CodexUsageCreditExpiryCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const STORAGE_KEY = "codexUsagePacerCreditExpirationsV1";
  const validAmount = (value) => Number.isFinite(value) && value >= 0;

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeGrant(value) {
    if (!value || typeof value.id !== "string" || !value.id ||
        typeof value.label !== "string" || !value.label.trim() ||
        !validAmount(value.amount) || !Number.isFinite(value.observedAtMs) ||
        !validDate(value.expiresOn)) return null;
    let sourceUrl = "";
    try {
      const url = new URL(value.sourceUrl);
      if (url.protocol === "https:") sourceUrl = url.href;
    } catch { /* Source links are optional. */ }
    return {
      id: value.id.slice(0, 100),
      label: value.label.trim().slice(0, 100),
      amount: value.amount,
      observedAtMs: value.observedAtMs,
      expiresOn: value.expiresOn,
      sourceUrl,
      // A correction allocates existing credits; a grant adds to the historical total.
      kind: value.kind === "allocation" ? "allocation" : "grant",
    };
  }

  function normalizeConfig(value) {
    const seen = new Set();
    const grants = (Array.isArray(value?.grants) ? value.grants : [])
      .map(normalizeGrant).filter((grant) => {
        if (!grant || seen.has(grant.id)) return false;
        seen.add(grant.id);
        return true;
      }).slice(0, 100);
    return { version: 1, grants };
  }

  function observationsFromHistory(history, current) {
    const byTime = new Map();
    const add = (atMs, count) => {
      if (Number.isFinite(atMs) && validAmount(count)) byTime.set(atMs, { atMs, count });
    };
    for (const event of history?.evidenceChanges || []) {
      if (event.entityType !== "credits") continue;
      add(event.previousCheckAtMs, event.oldValue?.count);
      add(event.detectedAtMs, event.newValue?.count);
    }
    add(history?.latestEvidence?.checkedAtMs, history?.latestEvidence?.credits?.count);
    add(current?.atMs, current?.count);
    return [...byTime.values()].sort((a, b) => a.atMs - b.atMs);
  }

  function balanceIncreases(observations) {
    return observations.slice(1).flatMap((observation, index) => {
      const amount = observation.count - observations[index].count;
      return amount > 0 ? [{ ...observation, amount }] : [];
    }).reverse();
  }

  function estimateBuckets(config, observations, nowMs = Date.now()) {
    const grants = normalizeConfig(config).grants;
    const points = observations.filter((point) => Number.isFinite(point.atMs) &&
      point.atMs <= nowMs && validAmount(point.count));
    if (!points.length) return { total: null, buckets: [], historyMissing: false };
    const events = [
      ...points.map((point) => ({ ...point, type: "observation" })),
      ...grants.filter((grant) => grant.observedAtMs <= nowMs)
        .map((grant) => ({ ...grant, atMs: grant.observedAtMs, type: "grant" })),
    ].sort((a, b) => a.atMs - b.atMs ||
      (a.type === b.type ? 0 : a.type === "grant" ? -1 : 1));
    const balances = [];
    let unknown = 0;
    let total = null;
    let historyMissing = false;
    let overflow = false;

    // This is an explicit planning assumption, not a claim about OpenAI's ledger.
    const consume = (amount) => {
      for (const balance of [...balances].sort((a, b) =>
        a.expiresOn.localeCompare(b.expiresOn) || a.observedAtMs - b.observedAtMs)) {
        const used = Math.min(amount, balance.remaining);
        balance.remaining -= used;
        amount -= used;
      }
      unknown = Math.max(0, unknown - amount);
    };

    for (const event of events) {
      if (event.type === "grant") {
        let remaining = event.amount;
        if (event.kind === "allocation") {
          remaining = Math.min(remaining, unknown);
          overflow ||= remaining < event.amount;
          unknown -= remaining;
        } else if (total !== null) {
          total += remaining;
        } else {
          historyMissing = true;
        }
        balances.push({ ...event, remaining });
        continue;
      }
      const previous = total ?? balances.reduce((sum, balance) => sum + balance.remaining, 0);
      if (event.count < previous) consume(previous - event.count);
      else unknown += event.count - previous;
      total = event.count;
    }

    // Never display an unobserved future grant as available credit.
    const lastPoint = [...points].sort((a, b) => b.atMs - a.atMs)[0];
    if (events[events.length - 1].type !== "observation") {
      return estimateBuckets(config, points, lastPoint.atMs);
    }
    const groups = new Map();
    for (const balance of balances) {
      if (balance.remaining <= 0) continue;
      const group = groups.get(balance.expiresOn) || {
        expiresOn: balance.expiresOn, remaining: 0, grants: [],
      };
      group.remaining += balance.remaining;
      group.grants.push({ label: balance.label, sourceUrl: balance.sourceUrl, remaining: balance.remaining });
      groups.set(balance.expiresOn, group);
    }
    const buckets = [...groups.values()].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    if (unknown > 0 || !buckets.length) buckets.push({ expiresOn: null, remaining: unknown, grants: [] });
    return { total, buckets, historyMissing, overflow };
  }

  return { STORAGE_KEY, normalizeConfig, normalizeGrant, observationsFromHistory, balanceIncreases, estimateBuckets };
});
