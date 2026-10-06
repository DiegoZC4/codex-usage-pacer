"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("./forecast-core.js");
const source = fs.readFileSync(require.resolve("./background.js"), "utf8");

function worker(fetch, cache = {}) {
  let listener;
  let installedListener;
  let reloads = 0;
  const refreshedTabs = [];
  const context = {
    fetch, Date, AbortSignal, Promise, URL,
    importScripts: () => {
      context.CodexUsageForecastCore = core;
      context.CodexUsagePageCore = require("./usage-page-core.js");
    },
    chrome: {
      runtime: {
        id: "test-extension",
        onMessage: { addListener: (value) => { listener = value; } },
        onInstalled: { addListener: (value) => { installedListener = value; } },
        reload: () => { reloads += 1; },
      },
      storage: { local: {
        get: async () => cache,
        set: async (value) => { Object.assign(cache, value); },
        remove: async (key) => { delete cache[key]; },
      } },
      tabs: { reload: async (id) => { refreshedTabs.push(id); } },
    },
  };
  vm.runInNewContext(source, context);
  const request = (message = {type: "codexUsagePacer:getResetForecast"}, sender = {}) =>
    new Promise((resolve) => {
      if (!listener(message, sender, resolve)) resolve(undefined);
    });
  return Object.assign(request, {
    installed: (reason) => installedListener({ reason }),
    reloads: () => reloads,
    refreshedTabs,
    storage: context.chrome.storage.local,
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

const reloadMessage = { type: "codexUsagePacer:reloadExtension" };
const analyticsSender = {
  id: "test-extension", frameId: 0, tab: { id: 42 },
  url: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
};
const pendingKey = "codexUsagePacerDevReloadPending";

test("self reload uses runtime.reload and preserves usage history across worker replacement", async () => {
  const history = { events: [{ id: "preserved" }] };
  const cache = { codexUsagePacerResetLogV1: history };
  const request = worker(() => assert.fail("reload must not fetch"), cache);
  assert.equal((await request(reloadMessage, analyticsSender)).ok, true);
  assert.equal(request.reloads(), 1);
  assert.equal(cache[pendingKey].tabId, 42);
  assert.equal(cache.codexUsagePacerResetLogV1, history);

  const replacement = worker(() => assert.fail("reload must not fetch"), cache);
  await replacement.installed("update");
  assert.deepEqual(replacement.refreshedTabs, [42]);
  assert.equal(cache[pendingKey], undefined);
  assert.equal(cache.codexUsagePacerResetLogV1, history);
  await replacement.installed("update");
  assert.deepEqual(replacement.refreshedTabs, [42]);
});

test("self reload accepts only this extension's top-level analytics content script", async () => {
  const request = worker(() => assert.fail("invalid reload must not fetch"));
  for (const sender of [
    {}, {...analyticsSender, id: "another-extension"},
    {...analyticsSender, frameId: 1}, {...analyticsSender, tab: {}},
    {...analyticsSender, tab: {id: -1}}, {...analyticsSender, url: "not a URL"},
    {...analyticsSender, url: "https://example.com/codex/cloud/settings/analytics"},
    {...analyticsSender, url: "https://chatgpt.com/codex/cloud"},
    {...analyticsSender, url: "https://chatgpt.com/settings/usage-other"},
  ]) assert.equal(await request(reloadMessage, sender), undefined);
  assert.equal(request.reloads(), 0);
});

test("self reload accepts the redesigned usage settings page", async () => {
  const request = worker(() => assert.fail("reload must not fetch"));
  const result = await request(reloadMessage, {
    ...analyticsSender, url: "https://chatgpt.com/settings/usage?tab=overview",
  });
  assert.equal(result.ok, true);
  assert.equal(request.reloads(), 1);
});

test("stale or malformed pending reloads never refresh a tab", async () => {
  for (const pending of [
    {tabId: 42, requestedAtMs: Date.now() - 31000},
    {tabId: 42, requestedAtMs: Date.now() + 60000},
    {tabId: 42}, {tabId: "42", requestedAtMs: Date.now()},
    {tabId: -1, requestedAtMs: Date.now()},
  ]) {
    const cache = {[pendingKey]: pending};
    const request = worker(() => {}, cache);
    await request.installed("update");
    assert.deepEqual(request.refreshedTabs, []);
    assert.equal(cache[pendingKey], undefined);
  }
});

test("normal installs and Chrome updates cannot consume an old tab reload request", async () => {
  for (const reason of ["install", "chrome_update"]) {
    const cache = {[pendingKey]: {tabId: 42, requestedAtMs: Date.now()}};
    const request = worker(() => {}, cache);
    await request.installed(reason);
    assert.deepEqual(request.refreshedTabs, []);
    assert.equal(cache[pendingKey], undefined);
  }
});

test("failed reload bookkeeping leaves the extension running", async () => {
  const request = worker(() => {});
  request.storage.set = async () => { throw Error("storage unavailable"); };
  const response = await request(reloadMessage, analyticsSender);
  assert.equal(response.ok, false);
  assert.match(response.error, /storage unavailable/);
  assert.equal(request.reloads(), 0);
});
