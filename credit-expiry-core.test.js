"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./credit-expiry-core.js");

const grant = (overrides = {}) => ({
  id: "promo", label: "Pro transition", amount: 62500, observedAtMs: 200,
  expiresOn: "2026-12-31", kind: "grant", ...overrides,
});
const points = (values) => values.map(([atMs, count]) => ({ atMs, count }));
const result = (grants, values, now = 1000) => core.estimateBuckets({ grants }, points(values), now);

test("balances reconcile with the dashboard and spend the known earliest expiry first", () => {
  const view = result([grant()], [[100, 33564], [200, 96064], [300, 95600]]);
  assert.deepEqual(view.buckets.map((b) => [b.expiresOn, b.remaining]), [
    ["2026-12-31", 62036], [null, 33564],
  ]);
  assert.equal(view.total, 95600);
  assert.equal(view.historyMissing, false);
  assert.equal(view.buckets.reduce((sum, b) => sum + b.remaining, 0), view.total);
});

test("multiple grants on one date are grouped, sorted and retain their sources", () => {
  const view = result([
    grant({ id: "later", amount: 30, observedAtMs: 200, expiresOn: "2027-01-01" }),
    grant({ id: "first", amount: 20, observedAtMs: 300, sourceUrl: "https://example.com/grant" }),
    grant({ id: "second", amount: 10, observedAtMs: 400 }),
  ], [[100, 5], [200, 35], [300, 55], [400, 65], [500, 40]]);
  assert.deepEqual(view.buckets.map((b) => [b.expiresOn, b.remaining]), [["2026-12-31", 5], ["2027-01-01", 30], [null, 5]]);
  const grouped = result([
    grant({ id: "a", amount: 10 }), grant({ id: "b", amount: 20, sourceUrl: "https://example.com/receipt" }),
  ], [[100, 0], [200, 30]]);
  assert.equal(grouped.buckets.length, 1);
  assert.equal(grouped.buckets[0].remaining, 30);
  assert.equal(grouped.buckets[0].grants.length, 2);
  assert.equal(grouped.buckets[0].grants[1].sourceUrl, "https://example.com/receipt");
});

test("new unregistered purchases stay undated rather than replenishing a promotional grant", () => {
  const view = result([grant({ amount: 100 })], [[100, 40], [200, 140], [300, 90], [400, 190]]);
  assert.deepEqual(view.buckets.map((b) => b.remaining), [50, 140]);
});

test("zero, exhausted and decimal balances remain valid", () => {
  assert.deepEqual(result([grant({ amount: 1 })], [[100, 2], [200, 3], [300, 0]]).buckets.map((b) => b.remaining), [0]);
  const view = result([grant({ amount: 1.5 })], [[100, 2], [200, 3.5], [300, 2.25]]);
  assert.deepEqual(view.buckets.map((b) => b.remaining), [0.25, 2]);
});

test("a current allocation dates existing credits without adding to the balance", () => {
  const view = result([grant({ kind: "allocation", amount: 40, observedAtMs: 201 })], [[100, 100], [200, 100], [300, 90]]);
  assert.deepEqual(view.buckets.map((b) => b.remaining), [30, 60]);
  const capped = result([grant({ kind: "allocation", amount: 150 })], [[100, 100], [300, 100]]);
  assert.equal(capped.total, 100);
  assert.equal(capped.overflow, true);
});

test("editing and removing grants replays observations without rewriting the evidence", () => {
  const observed = points([[100, 33564], [200, 96064], [300, 95600]]);
  const before = JSON.stringify(observed);
  const edited = core.estimateBuckets({ grants:[grant({expiresOn:"2027-03-01"})] }, observed, 1000);
  assert.equal(edited.buckets[0].expiresOn, "2027-03-01");
  assert.equal(edited.buckets[0].remaining, 62036);
  const removed = core.estimateBuckets({ grants:[] }, observed, 1000);
  assert.equal(removed.buckets.length, 1);
  assert.equal(removed.buckets[0].remaining, 95600);
  assert.equal(removed.buckets[0].expiresOn, null);
  assert.equal(JSON.stringify(observed), before);
});

test("unobserved spending at grant detection is allocated once, including repeated checks", () => {
  const view = result([grant()], [[100, 33564], [200, 95964], [300, 95964], [400, 95000]]);
  assert.equal(view.buckets[0].remaining, 61436);
  assert.equal(view.buckets[1].remaining, 33564);
});

test("dates do not silently remove available credits or invent an exact expiration hour", () => {
  const view = result([grant({ expiresOn: "2020-01-01", amount: 20 })], [[100, 40], [200, 60]], Date.now());
  assert.equal(view.buckets[0].expiresOn, "2020-01-01");
  assert.equal(view.total, 60);
});

test("missing historical baseline is flagged and totals stay reconciled", () => {
  const view = result([grant()], [[300, 95000]]);
  assert.equal(view.historyMissing, true);
  assert.equal(view.total, 95000);
  assert.deepEqual(view.buckets.map((b) => b.remaining), [62500, 32500]);
  assert.equal(result([grant()], [[300, 100]]).buckets[0].remaining, 100);
});

test("a grant after the latest observed balance is not presented as available", () => {
  assert.equal(result([grant()], [[100, 40]]).total, 40);
  assert.deepEqual(result([grant()], [[100, 40]]).buckets.map((b) => b.remaining), [40]);
  assert.equal(core.estimateBuckets({ grants: [grant()] }, []).total, null);
});

test("invalid grants and unsafe source links are rejected, duplicate IDs do not double count", () => {
  for (const overrides of [{ amount: -1 }, { amount: Infinity }, { observedAtMs: NaN }, { expiresOn: "2026-02-30" }, { expiresOn: "December" }]) {
    assert.equal(core.normalizeGrant(grant(overrides)), null);
  }
  assert.equal(core.normalizeGrant(grant({ sourceUrl: "javascript:alert(1)" })).sourceUrl, "");
  assert.equal(core.normalizeConfig({ grants: [grant(), grant()] }).grants.length, 1);
});

test("credit history ignores quota changes and invalid counts, and uses the newest observation", () => {
  const history = { evidenceChanges: [
    { entityType: "limit", detectedAtMs: 100, newValue: { count: 1 } },
    { entityType: "credits", previousCheckAtMs: 100, oldValue: { count: 30 }, detectedAtMs: 200, newValue: { count: 80 } },
    { entityType: "credits", previousCheckAtMs: 200, oldValue: { count: null }, detectedAtMs: 250, newValue: { count: null } },
  ], latestEvidence: { checkedAtMs: 300, credits: { count: 70 } } };
  const observed = core.observationsFromHistory(history, { atMs: 300, count: 69.5 });
  assert.deepEqual(observed, points([[100, 30], [200, 80], [300, 69.5]]));
  assert.deepEqual(core.balanceIncreases(observed), [{ atMs: 200, count: 80, amount: 50 }]);
});
