(function installForecastCore(root, factory) {
  "use strict";

  const api = factory();
  root.CodexUsageForecastCore = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const SOURCE_URL = "https://codexreset.org/";
  const CACHE_KEY = "codexUsagePacerForecastCacheV2";
  const DEFAULT_HIGH_CONFIDENCE = 0.8;
  const DEFAULT_MAX_HORIZON_MS = 7 * DAY_MS;
  const MAX_SNAPSHOT_AGE_MS = 2 * HOUR_MS;
  const PACIFIC_ZONE = "America/Los_Angeles";

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function elementWithTestId(html, testId) {
    const escaped = testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return String(html || "").match(
      new RegExp(`<[^>]+data-testid=["']${escaped}["'][^>]*>`, "i")
    )?.[0] || "";
  }

  function attributeValue(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(tag || "").match(
      new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
    );
    return match ? match[1] ?? match[2] ?? "" : "";
  }

  function parseProbabilityPercent(html, horizonHours) {
    const tag = elementWithTestId(html, `probability-ring-${horizonHours}h`);
    const rawTarget = attributeValue(tag, "data-target-value").trim();
    const target = rawTarget === "" ? NaN : Number(rawTarget);
    if (Number.isFinite(target) && target >= 0 && target <= 100) return target;

    const aria = attributeValue(tag, "aria-label");
    const match = aria.match(/:\s*(\d+(?:\.\d+)?)%\s*$/);
    const fallback = match ? Number(match[1]) : NaN;
    return Number.isFinite(fallback) && fallback >= 0 && fallback <= 100
      ? fallback
      : null;
  }

  function parseLastResetAtMs(html) {
    const tag = elementWithTestId(html, "reset-exact-time");
    const dateTime = attributeValue(tag, "dateTime");
    const exact = Date.parse(dateTime);
    if (Number.isFinite(exact)) return exact;

    const match = String(html || "").match(
      /<time\b[^>]*\bdata-testid=["']reset-exact-time["'][^>]*>([^<]+)<\/time>/i
    );
    if (!match) return null;
    const text = match[1]
      .replace(/&middot;|&#183;|·/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseMonitorHtml(html, fetchedAtMs = Date.now()) {
    const probability24Percent = parseProbabilityPercent(html, 24);
    const probability48Percent = parseProbabilityPercent(html, 48);
    if (probability24Percent === null || probability48Percent === null) return null;
    if (probability24Percent > probability48Percent) return null;

    const panel = elementWithTestId(html, "forecast-panel");
    const sampleSize = Number(attributeValue(panel, "data-calibration-sample-size"));
    const calibrationState = attributeValue(panel, "data-calibration-state").trim() || null;
    const calibrated = attributeValue(
      elementWithTestId(html, "probability-ring-48h"),
      "data-calibrated"
    );

    return normalizeSnapshot({
      sourceUrl: SOURCE_URL,
      fetchedAtMs,
      probability24Percent,
      probability48Percent,
      lastResetAtMs: parseLastResetAtMs(html),
      calibrationState,
      calibrationSampleSize: Number.isInteger(sampleSize) && sampleSize >= 0 ? sampleSize : null,
      calibrated: calibrated === "true" ? true : calibrated === "false" ? false : null,
    });
  }

  function announcementSourceUrl(value) {
    return typeof value === "string" &&
      /^https:\/\/(?:x\.com|twitter\.com)\/(?:thsottiaux|OpenAI|romainhuet|gdb|sama)\/status\/\d+$/i.test(value)
      ? value
      : null;
  }

  function wallParts(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    return Object.fromEntries(parts.filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
  }

  function dateAtOffset(timestamp, offsetHours) {
    const date = new Date(timestamp + offsetHours * HOUR_MS);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function wallTimestamp(parts, dayOffset, hour, minute) {
    return Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour, minute);
  }

  function pacificInstants(wallMs) {
    // Test both Pacific offsets against IANA timezone rules, including DST folds/gaps.
    return [7, 8].map((offset) => wallMs + offset * HOUR_MS).filter((instant) => {
      const parts = wallParts(instant, PACIFIC_ZONE);
      return wallTimestamp(parts, 0, parts.hour, parts.minute) === wallMs;
    });
  }

  function parseAnnouncement(signal) {
    const sourceUrl = announcementSourceUrl(signal?.sourceUrl);
    const publishedAtMs = finiteNumber(signal?.publishedAtMs);
    const text = typeof signal?.text === "string" ? signal.text : "";
    if (!sourceUrl || publishedAtMs === null || !/\breset\b/i.test(text)) return null;
    if (/\b(?:no|not|cancel\w*|postpon\w*|delay\w*)\b/i.test(text)) return null;

    // Only explicit, source-dated clock statements qualify. Do not guess a day
    // from "soon", a parent post, the fetch time, or a probability bucket.
    const matches = [...text.matchAll(
      /\b(?:lands?|landing|reset\s+will\s+(?:land|happen|arrive))\s+(?:(around|about|at|by|approximately)\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s*(PST|PDT|PT|Pacific(?:\s+Time)?|UTC|GMT)\s+(today|tomorrow)\b/gi
    )];
    if (matches.length !== 1) return null;
    const match = matches[0];
    if (match[1]?.toLowerCase() === "by") return null;
    let hour = Number(match[2]);
    const minute = Number(match[3] || 0);
    if (match[4]) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (match[4].toLowerCase() === "pm" ? 12 : 0);
    } else if (hour > 23) return null;
    const zone = match[5].toUpperCase();
    const dayOffset = match[6].toLowerCase() === "tomorrow" ? 1 : 0;
    let candidates;
    if (zone === "UTC" || zone === "GMT") {
      candidates = [wallTimestamp(dateAtOffset(publishedAtMs, 0), dayOffset, hour, minute)];
    } else {
      const day = wallParts(publishedAtMs, PACIFIC_ZONE);
      candidates = pacificInstants(wallTimestamp(day, dayOffset, hour, minute));
      if (zone === "PST" || zone === "PDT") {
        const offset = zone === "PST" ? -8 : -7;
        candidates.push(wallTimestamp(dateAtOffset(publishedAtMs, offset), dayOffset, hour, minute)
          - offset * HOUR_MS);
      }
    }
    candidates = [...new Set(candidates)].sort((a, b) => a - b);
    if (!candidates.length) return null;
    return {
      sourceUrl, publishedAtMs, phrase: match[0],
      startAtMs: candidates[0], endAtMs: candidates[candidates.length - 1],
      approximate: /^(around|about|approximately)$/i.test(match[1] || ""),
      timeZoneAmbiguous: candidates.length > 1,
    };
  }

  function normalizeAnnouncement(value) {
    if (!value || !announcementSourceUrl(value.sourceUrl)) return null;
    const { publishedAtMs, startAtMs, endAtMs } = value;
    if ([publishedAtMs, startAtMs, endAtMs].some((item) => finiteNumber(item) === null) ||
      endAtMs < startAtMs || startAtMs < publishedAtMs - DAY_MS ||
      endAtMs > publishedAtMs + 3 * DAY_MS) return null;
    return {
      sourceUrl: value.sourceUrl, publishedAtMs, startAtMs, endAtMs,
      phrase: typeof value.phrase === "string" ? value.phrase.slice(0, 200) : "",
      approximate: value.approximate === true,
      timeZoneAmbiguous: value.timeZoneAmbiguous === true,
    };
  }

  function enrichMonitorSnapshot(value, document) {
    const snapshot = normalizeSnapshot(value);
    if (!snapshot) return null;
    const checkedTime = document.querySelector('[data-testid="monitor-freshness"] time');
    const asOfMs = Date.parse(checkedTime?.getAttribute("datetime") ?? checkedTime?.getAttribute("dateTime"));
    snapshot.asOfMs = Number.isFinite(asOfMs) && asOfMs <= snapshot.fetchedAtMs + 5 * 60 * 1000
      ? asOfMs : snapshot.fetchedAtMs;
    const signals = [...document.querySelectorAll('[data-testid="reset-timeline-item"][data-kind="post"]')]
      .map((item) => ({
        publishedAtMs: Date.parse(item.getAttribute("data-datetime")),
        sourceUrl: item.getAttribute("data-source-url"),
        // Exclude quoted parent posts and other timeline card details.
        text: item.querySelector('[data-testid="x-timeline-post"] h3 + p')?.textContent || "",
      }))
      .filter((signal) => announcementSourceUrl(signal.sourceUrl) &&
        Number.isFinite(signal.publishedAtMs) && /\breset\b/i.test(signal.text) &&
        signal.publishedAtMs > (snapshot.lastResetAtMs ?? -Infinity) &&
        signal.publishedAtMs >= snapshot.asOfMs - DEFAULT_MAX_HORIZON_MS &&
        signal.publishedAtMs <= snapshot.fetchedAtMs + 5 * 60 * 1000)
      .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
    // A newer reset-related post supersedes old timing, even if it is ambiguous.
    snapshot.announcement = parseAnnouncement(signals[0]);
    return normalizeSnapshot(snapshot);
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== "object") return null;
    const fetchedAtMs = finiteNumber(value.fetchedAtMs);
    const probability24Percent = finiteNumber(value.probability24Percent);
    const probability48Percent = finiteNumber(value.probability48Percent);
    if (
      fetchedAtMs === null ||
      probability24Percent === null ||
      probability48Percent === null ||
      probability24Percent < 0 ||
      probability48Percent > 100 ||
      probability24Percent > probability48Percent
    ) {
      return null;
    }

    return {
      sourceUrl: SOURCE_URL,
      fetchedAtMs,
      asOfMs: finiteNumber(value.asOfMs) ?? fetchedAtMs,
      announcement: normalizeAnnouncement(value.announcement),
      probability24Percent,
      probability48Percent,
      lastResetAtMs: finiteNumber(value.lastResetAtMs),
      calibrationState:
        typeof value.calibrationState === "string" && value.calibrationState.trim()
          ? value.calibrationState.trim().slice(0, 80)
          : null,
      calibrationSampleSize:
        Number.isInteger(value.calibrationSampleSize) && value.calibrationSampleSize >= 0
          ? value.calibrationSampleSize
          : null,
      calibrated: typeof value.calibrated === "boolean" ? value.calibrated : null,
    };
  }

  function deriveMonitorForecast(value) {
    const snapshot = normalizeSnapshot(value);
    if (!snapshot) return null;

    const probability48 = snapshot.probability48Percent / 100;
    if (probability48 <= 0) return null;

    return {
      snapshot,
      confidence: probability48,
      forecastAtMs: snapshot.announcement?.startAtMs ?? null,
      forecastEndAtMs: snapshot.announcement?.endAtMs ?? null,
      windowEndAtMs: snapshot.asOfMs + 48 * HOUR_MS,
    };
  }

  function selectHighConfidenceForecast(
    defaultResetAtMs,
    value,
    nowMs = Date.now(),
    options = {}
  ) {
    if (!Number.isFinite(defaultResetAtMs) || !Number.isFinite(nowMs)) return null;
    const forecast = deriveMonitorForecast(value);
    if (!forecast) return null;

    const configuredConfidence = finiteNumber(options.minConfidence);
    const configuredHorizon = finiteNumber(options.maxHorizonMs);
    const minConfidence = configuredConfidence ?? DEFAULT_HIGH_CONFIDENCE;
    const maxHorizonMs = configuredHorizon ?? DEFAULT_MAX_HORIZON_MS;
    if (
      forecast.confidence < minConfidence ||
      nowMs - forecast.snapshot.asOfMs > MAX_SNAPSHOT_AGE_MS ||
      forecast.snapshot.asOfMs > nowMs + 5 * 60 * 1000 ||
      defaultResetAtMs <= nowMs
    ) {
      return null;
    }

    const snapshot = forecast.snapshot;
    const showMarker = forecast.forecastAtMs !== null &&
      forecast.forecastEndAtMs > nowMs &&
      forecast.forecastAtMs < defaultResetAtMs &&
      forecast.forecastEndAtMs <= nowMs + maxHorizonMs;

    return {
      defaultResetAtMs,
      forecastAtMs: showMarker ? forecast.forecastAtMs : null,
      forecastEndAtMs: showMarker ? Math.min(forecast.forecastEndAtMs, defaultResetAtMs) : null,
      windowEndAtMs: forecast.windowEndAtMs,
      confidence: forecast.confidence,
      minConfidence,
      maxHorizonMs,
      probabilityFirst24HoursPercent: snapshot.probability24Percent,
      probabilityHours24To48Percent:
        snapshot.probability48Percent - snapshot.probability24Percent,
      probabilityWithin48HoursPercent: snapshot.probability48Percent,
      snapshot,
    };
  }

  return {
    DEFAULT_HIGH_CONFIDENCE,
    DEFAULT_MAX_HORIZON_MS,
    MAX_SNAPSHOT_AGE_MS,
    CACHE_KEY,
    DAY_MS,
    HOUR_MS,
    SOURCE_URL,
    deriveMonitorForecast,
    enrichMonitorSnapshot,
    normalizeSnapshot,
    parseAnnouncement,
    parseMonitorHtml,
    selectHighConfidenceForecast,
  };
});
