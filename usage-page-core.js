(function installUsagePageCore(root, factory) {
  "use strict";
  const api = factory();
  root.CodexUsagePageCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const SETTINGS_ROW = '[class~="@container/settings-row"]';
  const MANAGED = '[data-codex-usage-pacer]';
  const REMAINING = /(\d+(?:\.\d+)?)%\s*(?:remaining|left)\b/i;

  function sourceText(card) {
    const copy = card.cloneNode(true);
    copy.querySelectorAll(`${MANAGED}, .codex-usage-pacer-overlay, .codex-usage-pacer-summary, .codex-usage-pacer-target, .codex-usage-pacer-forecast-link, .codex-usage-pacer-credit-note`).forEach((node) => node.remove());
    copy.querySelectorAll("div, p, header").forEach((node) => node.append(" "));
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  }

  function usageKind(text) {
    if (/^Weekly (?:usage )?limit/i.test(text)) return "weekly";
    if (/^5[ -]hour (?:usage )?limit/i.test(text)) return "five-hour";
    return null;
  }

  function remainingRaw(text) {
    const match = String(text).match(REMAINING);
    return match && Number(match[1]) <= 100 ? `${match[1]}%` : "";
  }

  function usageLabel(text) {
    // Preserve evidence keys across the site's label change.
    const kind = usageKind(text);
    if (kind === "weekly") return "Weekly usage limit";
    if (kind === "five-hour") return "5 hour usage limit";
    return text.split(/Resets\b|\d+(?:\.\d+)?%\s*(?:remaining|left)/i)[0].trim() || "Usage limit";
  }

  function candidateCards(document) {
    return [...document.querySelectorAll(`article, ${SETTINGS_ROW}`)]
      .filter((card) => !card.closest(MANAGED))
      .filter((card) => usageKind(sourceText(card)) || remainingRaw(sourceText(card)));
  }

  function creditCards(document) {
    const cards = [...document.querySelectorAll("article")].filter((card) =>
      /^Credits remaining|\b\d[\d.,]*\s+(?:reset\s+)?credits?\s+(?:available|remaining)\b/i.test(sourceText(card))
    );
    for (const row of document.querySelectorAll(SETTINGS_ROW)) {
      if (!row.closest(MANAGED) && /^\d[\d.,]*\s+credits?\s+remaining\b/i.test(sourceText(row))) {
        // Include the balance settings group, not the surrounding reset/history sections.
        const card = row.parentElement;
        if (card && !cards.some((existing) => existing === card || existing.contains(card))) cards.push(card);
      }
    }
    return cards;
  }

  function parseResetDate(text, now) {
    if (!text || /\bResets in\b/i.test(text)) return null;
    if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(text)) {
      const [, hh, mm, ampm] = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      const hour = Number(hh) % 12 + (/PM/i.test(ampm) ? 12 : 0);
      if (Number(hh) < 1 || Number(hh) > 12 || Number(mm) > 59) return null;
      const date = new Date(now);
      date.setHours(hour, Number(mm), 0, 0);
      if (date.getTime() <= now.getTime() - 60_000) date.setDate(date.getDate() + 1);
      return date;
    }
    const normalized = text.replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, "").replace(/\s+at\s+/i, " ");
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function resetText(card) {
    // The redesign exposes a second-precision, timezone-qualified date in title.
    // Never derive a reset timestamp from its rounded "in 5d 18h" countdown.
    for (const node of card.querySelectorAll("[title], time[datetime]")) {
      if (node.closest(MANAGED) || !/^Resets\b/i.test(node.textContent.trim())) continue;
      const exact = node.getAttribute("datetime") || node.getAttribute("title");
      if (parseResetDate(exact, new Date())) return exact;
    }
    const text = sourceText(card);
    const dated = text.match(/Resets\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    const timed = text.match(/Resets\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    return dated?.[1]?.trim() || timed?.[1]?.trim() || card.getAttribute("data-codex-usage-pacer-reset-text") || "";
  }

  function isUsagePath(path) {
    return ["/codex/cloud/settings/analytics", "/settings/usage"].includes(path.replace(/\/$/, ""));
  }

  return { SETTINGS_ROW, sourceText, usageKind, remainingRaw, usageLabel, candidateCards, creditCards, parseResetDate, resetText, isUsagePath };
});
