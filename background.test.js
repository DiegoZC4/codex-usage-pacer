"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("./forecast-core.js");
const source = fs.readFileSync(require.resolve("./background.js"), "utf8");

function worker(fetch, cache = {}) {
  let listener;
  const context = {
    fetch, Date, AbortSignal, Promise,
    importScripts: () => { context.CodexUsageForecastCore = core; },
    chrome: {
      runtime: { onMessage: { addListener: (value) => { listener = value; } } },
      storage: { local: { get: async () => cache } },
    },
  };
  vm.runInNewContext(source, context);
  return () => new Promise((resolve) => {
    assert.equal(listener({type: "codexUsagePacer:getResetForecast"}, {}, resolve), true);
  });
}

const html = '<div data-testid="probability-ring-24h" data-target-value="98"></div>' +
  '<div data-testid="probability-ring-48h" data-target-value="99"></div>';

function cachedSnapshot(ageMs = 0) {
  const now = Date.now();
  return core.normalizeSnapshot({
    fetchedAtMs: now - ageMs, probability24Percent: 98, probability48Percent: 99,
    announcement: {
      sourceUrl: "https://x.com/thsottiaux/status/12345", publishedAtMs: now,
      startAtMs: now + core.HOUR_MS, endAtMs: now + core.HOUR_MS,
    },
  });
}

test("worker returns public HTML for DOM parsing without storing the full source", async () => {
  const request = worker(async (url, options) => {
    assert.equal(url, core.SOURCE_URL);
    assert.equal(options.credentials, "omit");
    assert.ok(options.signal);
    return {ok: true, text: async () => html};
  });
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.stale, false);
  assert.equal(result.sourceHtml, html);
  assert.equal(result.snapshot.probability48Percent, 99);
});

test("failed fetch preserves the cached announcement and its source date", async () => {
  const snapshot = cachedSnapshot();
  const request = worker(async () => { throw Error("offline"); }, {[core.CACHE_KEY]: snapshot});
  const result = await request();
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
  assert.equal(result.snapshot.announcement.startAtMs, snapshot.announcement.startAtMs);
  assert.equal(result.snapshot.fetchedAtMs, snapshot.fetchedAtMs);
  assert.equal(result.sourceHtml, undefined);
});

test("expired or legacy caches do not recreate probability-derived timestamps", async () => {
  for (const cache of [
    {[core.CACHE_KEY]: cachedSnapshot(3 * core.HOUR_MS)},
    {codexUsagePacerForecastCacheV1: cachedSnapshot()},
  ]) {
    const result = await worker(async () => { throw Error("offline"); }, cache)();
    assert.equal(result.ok, false);
  }
});

test("simultaneous requests share one fetch without a poll or heartbeat", async () => {
  let count = 0;
  let finish;
  const request = worker(() => {
    count += 1;
    return new Promise((resolve) => { finish = resolve; });
  });
  const first = request();
  const second = request();
  finish({ok: true, text: async () => html});
  const results = await Promise.all([first, second]);
  assert.equal(count, 1);
  assert.ok(results.every((result) => result.ok));
});
