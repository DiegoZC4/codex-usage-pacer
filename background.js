"use strict";

importScripts("forecast-core.js", "usage-page-core.js");

const FORECAST_MESSAGE = "codexUsagePacer:getResetForecast";
const RELOAD_MESSAGE = "codexUsagePacer:reloadExtension";
const RELOAD_PENDING_KEY = "codexUsagePacerDevReloadPending";
const FORECAST_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const forecastCore = globalThis.CodexUsageForecastCore;
let inFlightForecast = null;

async function cachedForecast() {
  const stored = await chrome.storage.local.get(forecastCore.CACHE_KEY);
  const snapshot = forecastCore.normalizeSnapshot(stored?.[forecastCore.CACHE_KEY]);
  if (!snapshot) return null;
  const ageMs = Date.now() - snapshot.fetchedAtMs;
  return ageMs >= 0 && ageMs <= FORECAST_CACHE_MAX_AGE_MS ? snapshot : null;
}

async function fetchForecast() {
  try {
    const response = await fetch(forecastCore.SOURCE_URL, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Codex Reset Monitor returned HTTP ${response.status}`);

    const sourceHtml = await response.text();
    const snapshot = forecastCore.parseMonitorHtml(sourceHtml, Date.now());
    if (!snapshot) throw new Error("Codex Reset Monitor forecast markup was not recognized");
    // DOMParser lives in the content script, not the MV3 service worker.
    // Cache only its enriched snapshot; never persist the full source HTML.
    return { ok: true, snapshot, sourceHtml, stale: false };
  } catch (error) {
    const snapshot = await cachedForecast();
    if (snapshot) {
      return { ok: true, snapshot, stale: true, error: String(error?.message || error) };
    }
    return { ok: false, error: String(error?.message || error) };
  }
}

function currentForecast() {
  if (!inFlightForecast) {
    inFlightForecast = fetchForecast().finally(() => {
      inFlightForecast = null;
    });
  }
  return inFlightForecast;
}

function isAnalyticsSender(sender) {
  if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !Number.isInteger(sender.tab?.id) || sender.tab.id < 0) return false;
  try {
    const url = new URL(sender.url);
    return url.origin === "https://chatgpt.com" &&
      globalThis.CodexUsagePageCore.isUsagePath(url.pathname);
  } catch {
    return false;
  }
}

async function reloadFromAnalytics(sender, sendResponse) {
  try {
    // Local storage survives runtime.reload; session storage does not.
    await chrome.storage.local.set({
      [RELOAD_PENDING_KEY]: { tabId: sender.tab.id, requestedAtMs: Date.now() },
    });
    sendResponse({ ok: true });
    chrome.runtime.reload();
  } catch (error) {
    sendResponse({ ok: false, error: String(error?.message || error) });
  }
}

async function refreshAfterSelfReload(reason) {
  const stored = await chrome.storage.local.get(RELOAD_PENDING_KEY);
  const pending = stored?.[RELOAD_PENDING_KEY];
  if (!pending) return;
  await chrome.storage.local.remove(RELOAD_PENDING_KEY);
  const ageMs = Date.now() - pending.requestedAtMs;
  if (reason !== "update" || !Number.isInteger(pending.tabId) || pending.tabId < 0 ||
      !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 30000) return;
  // Only the tab that explicitly requested this update is refreshed, once.
  await chrome.tabs.reload(pending.tabId).catch(() => {});
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  return refreshAfterSelfReload(reason).catch((error) => {
    console.warn("Codex Usage Pacer could not refresh after its update.", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === RELOAD_MESSAGE) {
    if (!isAnalyticsSender(sender)) return false;
    reloadFromAnalytics(sender, sendResponse);
    return true;
  }
  if (message?.type !== FORECAST_MESSAGE) return false;
  currentForecast().then(sendResponse);
  return true;
});
