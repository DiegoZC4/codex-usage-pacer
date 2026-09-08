"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_HIGH_CONFIDENCE,
  HOUR_MS,
  deriveMonitorForecast,
  normalizeSnapshot,
  parseAnnouncement,
  parseMonitorHtml,
  selectHighConfidenceForecast,
} = require("./forecast-core.js");

const DAY_MS = 24 * HOUR_MS;

function monitorHtml(probability24, probability48) {
  return `
    <time dateTime="2026-08-08T20:29:22.000Z" data-testid="reset-exact-time">Aug 8, 2026 · 20:29 UTC</time>
    <section data-calibration-sample-size="16" data-calibration-state="experimental" data-testid="forecast-panel">
      <div data-testid="probability-ring-24h" data-target-value="${probability24}" data-calibrated="false"></div>
      <div aria-label="within 48 hours: ${probability48}%" data-calibrated="false" data-testid="probability-ring-48h" data-target-value="${probability48}"></div>
    </section>
  `;
}

test("parses forecast probabilities and calibration metadata from monitor HTML", () => {
  const fetchedAtMs = Date.UTC(2026, 7, 8, 23, 0);
  const snapshot = parseMonitorHtml(monitorHtml(15, 84), fetchedAtMs);

  assert.equal(snapshot.fetchedAtMs, fetchedAtMs);
  assert.equal(snapshot.probability24Percent, 15);
  assert.equal(snapshot.probability48Percent, 84);
  assert.equal(snapshot.calibrationState, "experimental");
  assert.equal(snapshot.calibrationSampleSize, 16);
  assert.equal(snapshot.calibrated, false);
  assert.equal(snapshot.lastResetAtMs, Date.UTC(2026, 7, 8, 20, 29, 22));
});

test("never invents a point timestamp from cumulative probabilities", () => {
  const fetchedAtMs = Date.UTC(2026, 7, 8, 23, 0);
  const snapshot = parseMonitorHtml(monitorHtml(15, 84), fetchedAtMs);
  const forecast = deriveMonitorForecast(snapshot);
  assert.equal(forecast.confidence, 0.84);
  assert.equal(forecast.forecastAtMs, null);
  assert.equal(forecast.windowEndAtMs, fetchedAtMs + 48 * HOUR_MS);
});

test("selects a high-confidence forecast without blending the official reset", () => {
  const nowMs = Date.UTC(2026, 7, 8, 23, 0);
  const defaultResetAtMs = nowMs + 7 * DAY_MS;
  const snapshot = parseMonitorHtml(monitorHtml(15, 84), nowMs);
  const forecast = deriveMonitorForecast(snapshot);
  const selected = selectHighConfidenceForecast(defaultResetAtMs, snapshot, nowMs);

  assert.equal(selected.forecastAtMs, forecast.forecastAtMs);
  assert.equal(selected.defaultResetAtMs, defaultResetAtMs);
  assert.equal(selected.confidence, 0.84);
  assert.equal(selected.minConfidence, DEFAULT_HIGH_CONFIDENCE);
  assert.equal(selected.probabilityFirst24HoursPercent, 15);
  assert.equal(selected.probabilityHours24To48Percent, 69);
  assert.equal(selected.probabilityWithin48HoursPercent, 84);
});

test("does not select a forecast below the high-confidence threshold", () => {
  const nowMs = Date.UTC(2026, 7, 8, 23, 0);
  const snapshot = parseMonitorHtml(monitorHtml(15, 79), nowMs);
  assert.equal(selectHighConfidenceForecast(nowMs + 7 * DAY_MS, snapshot, nowMs), null);
});

test("never draws a marker after an earlier official reset", () => {
  const nowMs = Date.UTC(2026, 7, 8, 23, 0);
  const snapshot = parseMonitorHtml(monitorHtml(15, 84), nowMs);
  snapshot.announcement = {
    sourceUrl: "https://x.com/thsottiaux/status/12345", publishedAtMs: nowMs,
    startAtMs: nowMs + 12 * HOUR_MS, endAtMs: nowMs + 12 * HOUR_MS,
  };
  const selected = selectHighConfidenceForecast(nowMs + 6 * HOUR_MS, snapshot, nowMs);
  assert.equal(selected.forecastAtMs, null);
  assert.equal(selected.defaultResetAtMs, nowMs + 6 * HOUR_MS);
});

test("does not draw a marker outside the configured horizon", () => {
  const nowMs = Date.UTC(2026, 7, 8, 23, 0);
  const snapshot = parseMonitorHtml(monitorHtml(15, 84), nowMs);
  snapshot.announcement = {
    sourceUrl: "https://x.com/thsottiaux/status/12345", publishedAtMs: nowMs,
    startAtMs: nowMs + 36 * HOUR_MS, endAtMs: nowMs + 36 * HOUR_MS,
  };
  assert.equal(
    selectHighConfidenceForecast(nowMs + 7 * DAY_MS, snapshot, nowMs, {
      maxHorizonMs: 24 * HOUR_MS,
    }).forecastAtMs,
    null
  );
});

test("rejects a non-monotonic cumulative forecast", () => {
  assert.equal(parseMonitorHtml(monitorHtml(80, 40), Date.now()), null);
});

const POST_URL = "https://x.com/thsottiaux/status/2097043464538264003";
const POSTED = Date.parse("2026-09-07T19:24:57Z");
const CHECKED = Date.parse("2026-09-07T23:00:00Z");

function announcement(text = "Global usage reset. Lands around 6pm PST today.", publishedAtMs = POSTED) {
  return parseAnnouncement({ text, publishedAtMs, sourceUrl: POST_URL });
}

function currentSnapshot(extra = {}) {
  return normalizeSnapshot({
    fetchedAtMs: CHECKED, asOfMs: CHECKED,
    probability24Percent: 98, probability48Percent: 99,
    announcement: announcement(), ...extra,
  });
}

test("September 7 announcement stays Monday evening, not a Tuesday bucket midpoint", () => {
  const result = announcement();
  assert.equal(result.startAtMs, Date.parse("2026-09-08T01:00:00Z"));
  assert.equal(result.endAtMs, Date.parse("2026-09-08T02:00:00Z"));
  assert.equal(result.timeZoneAmbiguous, true);
  assert.equal(result.approximate, true);
  assert.equal(result.sourceUrl, POST_URL);
  assert.equal(result.phrase, "Lands around 6pm PST today");
});

test("unambiguous PDT and PT resolve with daylight saving time", () => {
  for (const zone of ["PDT", "PT", "Pacific Time"]) {
    const result = announcement(`Global reset. Lands around 6pm ${zone} today.`);
    assert.equal(result.startAtMs, Date.parse("2026-09-08T01:00:00Z"));
    assert.equal(result.endAtMs, result.startAtMs);
    assert.equal(result.timeZoneAmbiguous, false);
  }
});

test("winter PST is unambiguous and uses UTC minus eight", () => {
  const result = announcement(undefined, Date.parse("2026-12-07T19:00:00Z"));
  assert.equal(result.startAtMs, Date.parse("2026-12-08T02:00:00Z"));
  assert.equal(result.endAtMs, result.startAtMs);
  assert.equal(result.timeZoneAmbiguous, false);
});

test("tomorrow is relative to the post's Pacific date, even after UTC midnight", () => {
  const result = announcement("Global reset. Lands at 6pm PT tomorrow.", Date.parse("2026-09-08T03:00:00Z"));
  assert.equal(result.startAtMs, Date.parse("2026-09-09T01:00:00Z"));
});

test("UTC date statements use UTC, including midnight and noon", () => {
  assert.equal(announcement("Global reset. Lands at 12am UTC tomorrow.").startAtMs, Date.parse("2026-09-08T00:00:00Z"));
  assert.equal(announcement("Global reset. Lands at 12pm UTC tomorrow.").startAtMs, Date.parse("2026-09-08T12:00:00Z"));
});

test("Pacific DST gaps are not silently normalized to a different clock time", () => {
  assert.equal(announcement("Global reset. Lands at 2:30am PT tomorrow.", Date.parse("2026-03-07T20:00:00Z")), null);
});

test("Pacific repeated hour is represented as a range", () => {
  const result = announcement("Global reset. Lands at 1:30am PT tomorrow.", Date.parse("2026-10-31T20:00:00Z"));
  assert.equal(result.endAtMs - result.startAtMs, HOUR_MS);
});

test("source clocks, dates and uncertainties survive cache round trips and refreshes", () => {
  const original = currentSnapshot();
  const later = normalizeSnapshot({ ...JSON.parse(JSON.stringify(original)), fetchedAtMs: CHECKED + 18 * HOUR_MS });
  assert.deepEqual(later.announcement, original.announcement);
  assert.equal(later.asOfMs, original.asOfMs);
});

test("high confidence announcement controls marker only, never pacing", () => {
  const official = CHECKED + 6 * DAY_MS;
  const selected = selectHighConfidenceForecast(official, currentSnapshot(), CHECKED);
  assert.equal(selected.forecastAtMs, Date.parse("2026-09-08T01:00:00Z"));
  assert.equal(selected.forecastEndAtMs, Date.parse("2026-09-08T02:00:00Z"));
  assert.equal(selected.defaultResetAtMs, official);
  assert.equal(selected.probabilityWithin48HoursPercent, 99);
});

test("passed announcements do not roll forward or fall back to an invented time", () => {
  const now = Date.parse("2026-09-08T04:00:00Z");
  const snapshot = currentSnapshot({ fetchedAtMs: now, asOfMs: now });
  const selected = selectHighConfidenceForecast(now + 5 * DAY_MS, snapshot, now);
  assert.equal(selected.forecastAtMs, null);
  assert.equal(selected.snapshot.announcement.startAtMs, Date.parse("2026-09-08T01:00:00Z"));
});

test("stale monitor data cannot become fresh merely by fetching it again", () => {
  const now = CHECKED + 5 * HOUR_MS;
  const snapshot = currentSnapshot({ fetchedAtMs: now });
  assert.equal(selectHighConfidenceForecast(now + 5 * DAY_MS, snapshot, now), null);
});

test("unclear, negative, conflicting or malformed statements do not invent timing", () => {
  for (const text of [
    "Global reset soon.", "Global reset. Lands around 6pm today.",
    "Global reset. Lands around 6pm PST.", "Global reset. Lands around 14pm PST today.",
    "No reset. Lands at 6pm PT today.", "Global reset cancelled. Lands at 6pm PT today.",
    "Global reset. Lands by 6pm PT today.",
    "Global reset. Lands at 6pm PT today. Lands at 7pm PT tomorrow.",
  ]) assert.equal(announcement(text), null, text);
});

test("untrusted or unsafe source URLs cannot become announcement links", () => {
  for (const sourceUrl of ["javascript:alert(1)", "https://x.com/unknown/status/123", "https://x.com.evil/thsottiaux/status/123"]) {
    assert.equal(parseAnnouncement({text: "Global reset. Lands at 6pm PT today.", sourceUrl, publishedAtMs: POSTED}), null);
  }
});

test("missing probabilities are not parsed as zero", () => {
  assert.equal(parseMonitorHtml("", CHECKED), null);
  assert.equal(parseMonitorHtml('<div data-testid="probability-ring-48h" data-target-value="99"></div>', CHECKED), null);
});
