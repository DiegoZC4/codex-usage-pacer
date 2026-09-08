"use strict";

importScripts("forecast-core.js");

const FORECAST_MESSAGE = "codexUsagePacer:getResetForecast";
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== FORECAST_MESSAGE) return false;
  currentForecast().then(sendResponse);
  return true;
});
