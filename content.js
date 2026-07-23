(() => {
  const STYLE_ID = "codex-usage-pacer-style";
  const OVERLAY_CLASS = "codex-usage-pacer-overlay";
  const CARD_CLASS = "codex-usage-pacer-card";
  const CARD_GROUP_CLASS = "codex-usage-pacer-card-group";
  const OLD_SUMMARY_CLASS = "codex-usage-pacer-summary";
  const TARGET_CLASS = "codex-usage-pacer-target";
  const CREDIT_NOTE_CLASS = "codex-usage-pacer-credit-note";
  const PROGRESS_CLASS = "codex-usage-pacer-square-progress";
  const RESET_CALENDAR_ID = "codex-usage-pacer-reset-calendar";
  const TOOLTIP_ID = "codex-usage-pacer-tooltip";
  const TOOLTIP_ATTR = "data-codex-usage-pacer-tooltip";
  const MANAGED_ATTR = "data-codex-usage-pacer";
  const RESET_ROW_ATTR = "data-codex-usage-pacer-reset-row";
  const RESET_TEXT_ATTR = "data-codex-usage-pacer-reset-text";
  const PROGRESS_ATTR = "data-codex-usage-pacer-progress";
  const INSTANCE_KEY = "__codexUsagePacerInstance";
  const FOCUS_RELOAD_AWAY_MIN_MS = 2 * 1000;
  const EVIDENCE_CAPTURE_SETTLE_MS = 500;
  const EVIDENCE_CAPTURE_FALLBACK_MS = 5 * 1000;
  const RESET_LOG_STORAGE_KEY = "codexUsagePacerResetLogV1";
  const FOCUS_RELOAD_MARKER_KEY = "codexUsagePacerFocusReloadPending";
  const RESET_LOG_GREEN_MINUTES = 10_000;
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const USAGE_TRACE_STALE_AFTER_MS = 6 * HOUR_MS;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const resetLogCore = globalThis.CodexUsageResetLogCore || null;
  let sawAway = document.hidden;
  let lastAwayAt = document.hidden ? Date.now() : 0;
  let resetLogState = resetLogCore?.normalizeState(null) || null;
  let resetLogStorageReady = false;
  let pendingWeeklyObservation = null;
  let pendingEvidenceObservation = null;
  let weeklyObservationCaptured = false;
  let evidenceObservationCaptured = false;
  let evidenceCaptureTimer = null;
  let evidenceSettleTimer = null;
  let focusReloadPending = false;
  let checkTrigger = "initial";
  let calendarCursor = null;
  let selectedCalendarDayKey = null;
  let observer = null;
  let activeTooltipTarget = null;
  let destroyed = false;
  let invalidationReloadScheduled = false;
  let persistQueued = false;

  window[INSTANCE_KEY]?.destroy?.();

  function destroyInstance() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    if (evidenceCaptureTimer !== null) window.clearTimeout(evidenceCaptureTimer);
    if (evidenceSettleTimer !== null) window.clearTimeout(evidenceSettleTimer);
    window.removeEventListener("blur", markAway);
    window.removeEventListener("focus", maybeReloadOnFocus);
    window.removeEventListener("pagehide", markAway);
    window.removeEventListener("pageshow", handlePageShow);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("pointerover", handleTooltipPointerOver);
    document.removeEventListener("pointermove", handleTooltipPointerMove);
    document.removeEventListener("pointerout", handleTooltipPointerOut);
    document.removeEventListener("focusin", handleTooltipFocusIn);
    document.removeEventListener("focusout", handleTooltipFocusOut);
    document.getElementById(RESET_CALENDAR_ID)?.remove();
    document.getElementById(TOOLTIP_ID)?.remove();
    activeTooltipTarget = null;
    if (window[INSTANCE_KEY]?.destroy === destroyInstance) {
      delete window[INSTANCE_KEY];
    }
  }

  function hasExtensionContext() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function isExtensionContextInvalidatedError(error) {
    return /Extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function retireInvalidatedInstance() {
    if (invalidationReloadScheduled) return;
    invalidationReloadScheduled = true;
    destroyInstance();
    window.setTimeout(() => window.location.reload(), 0);
  }

  function handleStorageError(action, error) {
    if (!hasExtensionContext() || isExtensionContextInvalidatedError(error)) {
      retireInvalidatedInstance();
      return true;
    }
    console.warn(`Codex Usage Pacer could not ${action} the reset log.`, error);
    return false;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute(MANAGED_ATTR, "true");
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 3;
        overflow: visible;
      }
      .${CARD_GROUP_CLASS} {
        display: grid !important;
        grid-template-columns: 1fr !important;
      }
      .${CARD_CLASS} {
        width: 100% !important;
        max-width: none !important;
      }
      .${PROGRESS_CLASS},
      .${PROGRESS_CLASS} > div:not(.${OVERLAY_CLASS}) {
        border-radius: 0 !important;
      }
      .${PROGRESS_CLASS} {
        --codex-usage-pacer-label-size: 14px;
        --codex-usage-pacer-axis-inset: 35px;
        --codex-usage-pacer-rail-height: 12px;
        --codex-usage-pacer-tick-length: 11px;
        --codex-usage-pacer-label-position: 25px;
        --codex-usage-pacer-label-band: 18px;
        --codex-usage-pacer-marker-height: 11px;
        --codex-usage-pacer-marker-space: var(--codex-usage-pacer-marker-height);
        --codex-usage-pacer-marker-half-width: 6.35px;
        --codex-usage-pacer-stroke: 1px;
        width: calc(100% - (2 * var(--codex-usage-pacer-axis-inset))) !important;
        height: calc(
          var(--codex-usage-pacer-marker-space) +
          var(--codex-usage-pacer-rail-height) +
          var(--codex-usage-pacer-label-position) +
          var(--codex-usage-pacer-label-band)
        ) !important;
        margin-inline: var(--codex-usage-pacer-axis-inset) !important;
        margin-block-start: calc(-1 * var(--codex-usage-pacer-marker-space)) !important;
      }
      .${PROGRESS_CLASS} > div:not(.${OVERLAY_CLASS}) {
        top: var(--codex-usage-pacer-marker-space) !important;
        bottom: auto !important;
        height: var(--codex-usage-pacer-rail-height) !important;
      }
      .${PROGRESS_CLASS} > div:not(.${OVERLAY_CLASS}):not(:first-child) {
        inset-inline-start: auto !important;
        inset-inline-end: 0 !important;
        left: auto !important;
        right: 0 !important;
      }
      .codex-usage-pacer-tick {
        position: absolute;
        top: calc(var(--codex-usage-pacer-marker-space) + var(--codex-usage-pacer-rail-height));
        width: 0;
        height: var(--codex-usage-pacer-tick-length);
        border-left: var(--codex-usage-pacer-stroke) solid rgba(255, 255, 255, 0.42);
        transform: translateX(-0.5px);
      }
      .codex-usage-pacer-tick span {
        position: absolute;
        top: var(--codex-usage-pacer-label-position);
        left: 0;
        transform: translate(-50%, -0.8em);
        color: rgba(255, 255, 255, 0.58);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: var(--codex-usage-pacer-label-size);
        line-height: 1.1;
        white-space: nowrap;
      }
      .codex-usage-pacer-tick[data-kind="reset"] {
        top: var(--codex-usage-pacer-marker-space);
        height: 0;
        border-left: 0;
        transform: none;
      }
      .codex-usage-pacer-tick[data-kind="reset"] span {
        top: 0;
        left: 8px;
        right: auto;
        transform: none;
        text-align: left;
      }
      .codex-usage-pacer-marker {
        position: absolute;
        top: 0;
        width: 0;
        height: 0;
        border-left: var(--codex-usage-pacer-marker-half-width) solid transparent;
        border-right: var(--codex-usage-pacer-marker-half-width) solid transparent;
        border-top: var(--codex-usage-pacer-marker-height) solid #facc15;
        filter: none;
        transform: translateX(calc(-1 * var(--codex-usage-pacer-marker-half-width)));
      }
      .${TARGET_CLASS} {
        color: rgba(255, 255, 255, 0.66);
        font-size: 16px;
        line-height: 22px;
        font-weight: 700;
        white-space: nowrap;
      }
      .${CREDIT_NOTE_CLASS} {
        margin-top: 8px;
        color: rgba(255, 255, 255, 0.68);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 18px;
        font-weight: 650;
      }
      .${CREDIT_NOTE_CLASS}[data-missing="true"] {
        color: rgba(255, 255, 255, 0.48);
      }
      #${TOOLTIP_ID} {
        position: fixed;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 16px));
        padding: 7px 9px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.98);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
        color: #f8fafc;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        line-height: 17px;
        white-space: pre-line;
        overflow-wrap: anywhere;
        pointer-events: none;
      }
      #${TOOLTIP_ID}[hidden] {
        display: none;
      }
      .${OVERLAY_CLASS} [${TOOLTIP_ATTR}] {
        pointer-events: auto;
        cursor: help;
      }
      #${RESET_CALENDAR_ID} {
        width: 100%;
        padding-top: 4px;
        color: rgba(255, 255, 255, 0.92);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .codex-usage-pacer-calendar-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }
      .codex-usage-pacer-calendar-heading {
        min-width: 0;
      }
      .codex-usage-pacer-calendar-heading h3 {
        margin: 0;
        font-size: 16px;
        line-height: 22px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .codex-usage-pacer-calendar-meta {
        margin: 2px 0 0;
        color: rgba(255, 255, 255, 0.56);
        font-size: 12px;
        line-height: 17px;
      }
      .codex-usage-pacer-calendar-nav {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .codex-usage-pacer-calendar-month {
        min-width: 126px;
        color: rgba(255, 255, 255, 0.84);
        font-size: 13px;
        line-height: 30px;
        font-weight: 650;
        text-align: center;
      }
      .codex-usage-pacer-calendar-nav button {
        display: inline-grid;
        place-items: center;
        min-width: 30px;
        height: 30px;
        padding: 0 8px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.82);
        font: inherit;
        font-size: 13px;
        line-height: 1;
        cursor: pointer;
      }
      .codex-usage-pacer-calendar-nav button:hover {
        background: rgba(255, 255, 255, 0.09);
        color: #fff;
      }
      .codex-usage-pacer-calendar-nav button:focus-visible {
        outline: 2px solid #facc15;
        outline-offset: 2px;
      }
      .codex-usage-pacer-calendar-scroll {
        overflow-x: auto;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
      }
      .codex-usage-pacer-calendar-weekdays,
      .codex-usage-pacer-calendar-days {
        display: grid;
        grid-template-columns: repeat(7, minmax(116px, 1fr));
        min-width: 812px;
      }
      .codex-usage-pacer-calendar-weekday {
        padding: 7px 8px;
        border-right: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.035);
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        line-height: 16px;
        font-weight: 700;
        text-align: center;
        text-transform: uppercase;
      }
      .codex-usage-pacer-calendar-weekday:last-child {
        border-right: 0;
      }
      .codex-usage-pacer-calendar-day {
        position: relative;
        min-height: 104px;
        padding: 7px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        border-right: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.012);
        overflow: hidden;
      }
      .codex-usage-pacer-calendar-day[data-has-data="true"] {
        cursor: pointer;
      }
      .codex-usage-pacer-calendar-day[data-selected="true"] {
        background: rgba(125, 211, 252, 0.07);
      }
      .codex-usage-pacer-calendar-day:focus-visible {
        z-index: 4;
        outline: 2px solid #7dd3fc;
        outline-offset: -2px;
      }
      .codex-usage-pacer-calendar-day:nth-child(7n) {
        border-right: 0;
      }
      .codex-usage-pacer-calendar-day[data-outside="true"] {
        background: transparent;
        color: rgba(255, 255, 255, 0.28);
      }
      .codex-usage-pacer-calendar-day[data-today="true"] {
        box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.72);
      }
      .codex-usage-pacer-calendar-date {
        position: relative;
        z-index: 4;
        display: block;
        color: rgba(255, 255, 255, 0.62);
        font-size: 11px;
        line-height: 15px;
        font-weight: 700;
        pointer-events: none;
      }
      .codex-usage-pacer-calendar-day[data-outside="true"] .codex-usage-pacer-calendar-date {
        color: rgba(255, 255, 255, 0.28);
      }
      .codex-usage-pacer-calendar-plot {
        position: absolute;
        z-index: 1;
        inset: 0;
      }
      .codex-usage-pacer-calendar-day[data-outside="true"] .codex-usage-pacer-calendar-plot {
        opacity: 0.42;
      }
      .codex-usage-pacer-usage-trace {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }
      .codex-usage-pacer-usage-grid {
        stroke: rgba(255, 255, 255, 0.055);
        stroke-width: 0.8;
        vector-effect: non-scaling-stroke;
      }
      .codex-usage-pacer-usage-fill {
        fill: rgba(125, 211, 252, 0.055);
      }
      .codex-usage-pacer-usage-segment {
        fill: none;
        stroke: rgba(125, 211, 252, 0.42);
        stroke-width: 1.25;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }
      .codex-usage-pacer-usage-segment[data-stale="true"] {
        stroke: rgba(125, 211, 252, 0.23);
        stroke-dasharray: 2.5 3;
      }
      .codex-usage-pacer-usage-dot {
        fill: rgba(186, 230, 253, 0.72);
        stroke: rgba(15, 23, 42, 0.55);
        stroke-width: 0.8;
        vector-effect: non-scaling-stroke;
      }
      .codex-usage-pacer-calendar-marker {
        --codex-reset-shift-hue: 0;
        position: absolute;
        z-index: 3;
        display: grid;
        place-items: center;
        width: 13px;
        height: 13px;
        transform: translate(-50%, -50%);
        cursor: help;
      }
      .codex-usage-pacer-calendar-marker::before {
        content: "";
        display: block;
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5));
      }
      .codex-usage-pacer-calendar-marker[data-marker-kind="reset"]::before {
        width: 7px;
        height: 7px;
        transform: rotate(45deg);
        border: 1px solid hsl(var(--codex-reset-shift-hue) 82% 76%);
        background: hsl(var(--codex-reset-shift-hue) 76% 48%);
      }
      .codex-usage-pacer-calendar-marker[data-marker-kind="usage-increase"]::before {
        width: 0;
        height: 0;
        border-right: 4px solid transparent;
        border-bottom: 8px solid #7dd3fc;
        border-left: 4px solid transparent;
      }
      .codex-usage-pacer-calendar-marker[data-marker-kind="usage-decrease"]::before {
        width: 0;
        height: 0;
        border-top: 8px solid #7dd3fc;
        border-right: 4px solid transparent;
        border-left: 4px solid transparent;
      }
      .codex-usage-pacer-calendar-marker[data-marker-kind="check"]::before {
        width: 2px;
        height: 7px;
        border-radius: 1px;
        background: rgba(203, 213, 225, 0.58);
      }
      .codex-usage-pacer-calendar-marker[data-marker-kind="evidence"]::before {
        width: 5px;
        height: 5px;
        border: 1px solid rgba(165, 243, 252, 0.82);
        background: rgba(8, 145, 178, 0.82);
      }
      .codex-usage-pacer-calendar-details {
        display: grid;
        gap: 7px;
        padding: 11px 0 2px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
      }
      .codex-usage-pacer-calendar-details[hidden] {
        display: none;
      }
      .codex-usage-pacer-calendar-details-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .codex-usage-pacer-calendar-details-date {
        font-size: 13px;
        line-height: 18px;
        font-weight: 750;
      }
      .codex-usage-pacer-calendar-details-summary {
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        line-height: 16px;
      }
      .codex-usage-pacer-calendar-detail-rows {
        display: grid;
        gap: 4px;
      }
      .codex-usage-pacer-calendar-detail-row {
        display: grid;
        grid-template-columns: 72px 74px 64px minmax(0, 1fr);
        gap: 8px;
        align-items: baseline;
        min-width: 0;
        font-size: 11px;
        line-height: 16px;
        font-variant-numeric: tabular-nums;
      }
      .codex-usage-pacer-calendar-detail-time,
      .codex-usage-pacer-calendar-detail-note {
        color: rgba(255, 255, 255, 0.58);
      }
      .codex-usage-pacer-calendar-detail-kind {
        font-weight: 750;
        white-space: nowrap;
      }
      .codex-usage-pacer-calendar-detail-kind[data-kind="usage-increase"],
      .codex-usage-pacer-calendar-detail-kind[data-kind="usage-decrease"],
      .codex-usage-pacer-calendar-detail-kind[data-kind="reset"] {
        color: #7dd3fc;
      }
      .codex-usage-pacer-calendar-detail-kind[data-kind="check"] {
        color: rgba(203, 213, 225, 0.78);
      }
      .codex-usage-pacer-calendar-detail-kind[data-kind="evidence"] {
        color: #a5f3fc;
      }
      .codex-usage-pacer-calendar-detail-value {
        color: rgba(255, 255, 255, 0.82);
        font-weight: 700;
      }
      .codex-usage-pacer-calendar-empty {
        min-height: 17px;
        margin: 8px 0 0;
        color: rgba(255, 255, 255, 0.46);
        font-size: 12px;
        line-height: 17px;
      }
      @media (prefers-color-scheme: light) {
        .codex-usage-pacer-tick {
          border-left-color: rgba(15, 23, 42, 0.32);
        }
        .codex-usage-pacer-tick span {
          color: rgba(15, 23, 42, 0.58);
        }
        .${TARGET_CLASS} {
          color: rgba(15, 23, 42, 0.62);
        }
        .${CREDIT_NOTE_CLASS} {
          color: rgba(15, 23, 42, 0.68);
        }
        .${CREDIT_NOTE_CLASS}[data-missing="true"] {
          color: rgba(15, 23, 42, 0.48);
        }
        #${TOOLTIP_ID} {
          border-color: rgba(15, 23, 42, 0.18);
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
          color: #0f172a;
        }
        #${RESET_CALENDAR_ID} {
          color: rgba(15, 23, 42, 0.92);
        }
        .codex-usage-pacer-calendar-meta,
        .codex-usage-pacer-calendar-empty {
          color: rgba(15, 23, 42, 0.54);
        }
        .codex-usage-pacer-calendar-month,
        .codex-usage-pacer-calendar-nav button {
          color: rgba(15, 23, 42, 0.82);
        }
        .codex-usage-pacer-calendar-nav button {
          border-color: rgba(15, 23, 42, 0.18);
          background: rgba(15, 23, 42, 0.03);
        }
        .codex-usage-pacer-calendar-nav button:hover {
          background: rgba(15, 23, 42, 0.08);
          color: #0f172a;
        }
        .codex-usage-pacer-calendar-scroll {
          border-color: rgba(15, 23, 42, 0.14);
        }
        .codex-usage-pacer-calendar-weekday {
          border-right-color: rgba(15, 23, 42, 0.1);
          background: rgba(15, 23, 42, 0.035);
          color: rgba(15, 23, 42, 0.5);
        }
        .codex-usage-pacer-calendar-day {
          border-top-color: rgba(15, 23, 42, 0.1);
          border-right-color: rgba(15, 23, 42, 0.1);
          background: rgba(15, 23, 42, 0.012);
        }
        .codex-usage-pacer-calendar-day[data-selected="true"] {
          background: rgba(2, 132, 199, 0.07);
        }
        .codex-usage-pacer-calendar-date {
          color: rgba(15, 23, 42, 0.62);
        }
        .codex-usage-pacer-calendar-day[data-outside="true"],
        .codex-usage-pacer-calendar-day[data-outside="true"] .codex-usage-pacer-calendar-date {
          color: rgba(15, 23, 42, 0.28);
        }
        .codex-usage-pacer-usage-grid {
          stroke: rgba(15, 23, 42, 0.06);
        }
        .codex-usage-pacer-usage-fill {
          fill: rgba(2, 132, 199, 0.05);
        }
        .codex-usage-pacer-usage-segment {
          stroke: rgba(2, 132, 199, 0.42);
        }
        .codex-usage-pacer-usage-segment[data-stale="true"] {
          stroke: rgba(2, 132, 199, 0.22);
        }
        .codex-usage-pacer-usage-dot {
          fill: rgba(3, 105, 161, 0.72);
          stroke: rgba(255, 255, 255, 0.7);
        }
        .codex-usage-pacer-calendar-details {
          border-top-color: rgba(15, 23, 42, 0.12);
        }
        .codex-usage-pacer-calendar-details-summary,
        .codex-usage-pacer-calendar-detail-time,
        .codex-usage-pacer-calendar-detail-note {
          color: rgba(15, 23, 42, 0.56);
        }
        .codex-usage-pacer-calendar-detail-value {
          color: rgba(15, 23, 42, 0.82);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureInstantTooltip() {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute(MANAGED_ATTR, "true");
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    (document.body || document.documentElement).appendChild(tooltip);
    return tooltip;
  }

  function setInstantTooltip(element, text) {
    const value = String(text || "").trim();
    element.removeAttribute("title");
    if (value) element.setAttribute(TOOLTIP_ATTR, value);
    else element.removeAttribute(TOOLTIP_ATTR);
  }

  function instantTooltipTarget(node) {
    const target = node?.closest?.(`[${TOOLTIP_ATTR}]`) || null;
    return target && document.documentElement.contains(target) ? target : null;
  }

  function positionInstantTooltip(clientX, clientY) {
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (!tooltip || tooltip.hidden) return;
    const gap = 12;
    const edge = 8;
    const bounds = tooltip.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + bounds.width > window.innerWidth - edge) left = clientX - bounds.width - gap;
    if (top + bounds.height > window.innerHeight - edge) top = clientY - bounds.height - gap;
    tooltip.style.left = `${clamp(left, edge, Math.max(edge, window.innerWidth - bounds.width - edge))}px`;
    tooltip.style.top = `${clamp(top, edge, Math.max(edge, window.innerHeight - bounds.height - edge))}px`;
  }

  function showInstantTooltip(target, clientX, clientY) {
    const text = target?.getAttribute?.(TOOLTIP_ATTR);
    if (!text) return;
    const tooltip = ensureInstantTooltip();
    activeTooltipTarget = target;
    tooltip.textContent = text;
    tooltip.hidden = false;
    positionInstantTooltip(clientX, clientY);
  }

  function hideInstantTooltip() {
    const tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) tooltip.hidden = true;
    activeTooltipTarget = null;
  }

  function handleTooltipPointerOver(event) {
    const target = instantTooltipTarget(event.target);
    if (!target) return;
    showInstantTooltip(target, event.clientX, event.clientY);
  }

  function handleTooltipPointerMove(event) {
    const target = instantTooltipTarget(event.target);
    if (!target) return;
    if (target !== activeTooltipTarget) showInstantTooltip(target, event.clientX, event.clientY);
    else positionInstantTooltip(event.clientX, event.clientY);
  }

  function handleTooltipPointerOut(event) {
    const target = instantTooltipTarget(event.target);
    if (!target || target !== activeTooltipTarget) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    if (instantTooltipTarget(event.relatedTarget) === target) return;
    hideInstantTooltip();
  }

  function handleTooltipFocusIn(event) {
    const target = instantTooltipTarget(event.target);
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    showInstantTooltip(target, bounds.left + bounds.width / 2, bounds.bottom);
  }

  function handleTooltipFocusOut(event) {
    const target = instantTooltipTarget(event.target);
    if (!target || target !== activeTooltipTarget) return;
    if (instantTooltipTarget(event.relatedTarget) === target) return;
    hideInstantTooltip();
  }

  function isManagedNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.hasAttribute?.(MANAGED_ATTR)) return true;
    if (node.id === STYLE_ID) return true;
    if (
      node.classList?.contains(OVERLAY_CLASS) ||
      node.classList?.contains(OLD_SUMMARY_CLASS) ||
      node.classList?.contains(TARGET_CLASS) ||
      node.classList?.contains(CREDIT_NOTE_CLASS) ||
      node.id === RESET_CALENDAR_ID
    ) {
      return true;
    }
    return Boolean(
      node.closest?.(
        `[${MANAGED_ATTR}], .${OVERLAY_CLASS}, .${OLD_SUMMARY_CLASS}, .${TARGET_CLASS}, .${CREDIT_NOTE_CLASS}, #${RESET_CALENDAR_ID}`
      )
    );
  }

  function cleanupUsageCard(card) {
    card.querySelectorAll(`.${OVERLAY_CLASS}, .${OLD_SUMMARY_CLASS}, .${TARGET_CLASS}`).forEach((node) => node.remove());
    card.querySelectorAll(`.${PROGRESS_CLASS}, [${PROGRESS_ATTR}]`).forEach((node) => {
      node.classList.remove(PROGRESS_CLASS);
      node.removeAttribute(PROGRESS_ATTR);
      if (node.style.overflow === "visible") node.style.overflow = "";
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sourceCardText(card) {
    const copy = card.cloneNode(true);
    copy
      .querySelectorAll(
        `[${MANAGED_ATTR}], .${OVERLAY_CLASS}, .${OLD_SUMMARY_CLASS}, .${TARGET_CLASS}, .${CREDIT_NOTE_CLASS}`
      )
      .forEach((node) => node.remove());
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  }

  function parseRemainingRaw(card) {
    const match = sourceCardText(card).match(/(\d+(?:\.\d+)?)%\s*remaining/i);
    return match ? `${match[1]}%` : "";
  }

  function parseRemaining(card) {
    const raw = parseRemainingRaw(card);
    return raw ? Number(raw.slice(0, -1)) : null;
  }

  function remainingPrecision(raw) {
    const decimal = String(raw || "").match(/\.(\d+)%$/);
    return decimal ? decimal[1].length : 0;
  }

  function parseUsageLabel(card) {
    const match = sourceCardText(card).match(/^(.*?)\s*\d+(?:\.\d+)?%\s*remaining/i);
    return match?.[1]?.trim() || "Usage limit";
  }

  function parseVisibleResetText(card) {
    const text = sourceCardText(card);
    const dated = text.match(/Resets\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    if (dated) return dated[1].trim();

    const timed = text.match(/Resets\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    return timed ? timed[1].trim() : "";
  }

  function parseResetText(card) {
    return parseVisibleResetText(card) || card.getAttribute(RESET_TEXT_ATTR) || "";
  }

  function parseResetDate(resetText, now) {
    if (!resetText) return null;

    if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(resetText)) {
      const [_, hh, mm, ampm] = resetText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i) || [];
      let hour = Number(hh);
      const minute = Number(mm);
      if (/PM/i.test(ampm) && hour !== 12) hour += 12;
      if (/AM/i.test(ampm) && hour === 12) hour = 0;
      const date = new Date(now);
      date.setHours(hour, minute, 0, 0);
      if (date.getTime() <= now.getTime() - 60 * 1000) {
        date.setDate(date.getDate() + 1);
      }
      return date;
    }

    const parsed = new Date(resetText);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function findProgressBar(card) {
    const candidates = [...card.querySelectorAll("div")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 120 && rect.height >= 8 && rect.height <= 18;
    });
    return (
      candidates.find((el) => el.children.length >= 2) ||
      candidates.find((el) => el.children.length >= 1) ||
      candidates[0] ||
      null
    );
  }

  function findResetRow(card) {
    const stored = card.querySelector(`[${RESET_ROW_ATTR}]`);
    if (stored) return stored;

    const rows = [...card.querySelectorAll("div, span")].filter((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return /^Resets\b/.test(text);
    });
    return rows[0] || null;
  }

  function findRemainingRow(card) {
    const rows = [...card.querySelectorAll("div, p, span")].filter((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return /\d+(?:\.\d+)?%\s*remaining/i.test(text);
    });
    return rows.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0] || null;
  }

  function getCards() {
    return [...document.querySelectorAll("article")].filter((card) => {
      const text = sourceCardText(card);
      const trimmed = text.trim();
      const isFiveHour = /^5 hour usage limit/.test(trimmed);
      const isWeekly = /^Weekly usage limit/.test(trimmed);
      return isFiveHour || isWeekly;
    });
  }

  function getEvidenceUsageCards() {
    return [...document.querySelectorAll("article")].filter((card) =>
      /\d+(?:\.\d+)?%\s*remaining/i.test(sourceCardText(card))
    );
  }

  function getUsageCandidateCards() {
    return [...document.querySelectorAll("article")].filter((card) => {
      const text = sourceCardText(card);
      return !/^Credits remaining\b/i.test(text) && /\b(?:usage|remaining|Codex)\b/i.test(text);
    });
  }

  function getCreditCards() {
    return [...document.querySelectorAll("article")].filter((card) => {
      const text = sourceCardText(card);
      return /^Credits remaining\b/i.test(text) || /\b\d+\s+(?:reset\s+)?credits?\s+(?:available|remaining)\b/i.test(text);
    });
  }

  function parseCreditCountRaw(card) {
    const text = sourceCardText(card);
    const compactMatch = text.match(/Credits remaining\s*(\d+)/i);
    if (compactMatch) return compactMatch[1];
    const availableMatch = text.match(/\b(\d+)\s+(?:reset\s+)?credits?\s+(?:available|remaining)\b/i);
    return availableMatch?.[1] || "";
  }

  function parseCreditCount(card) {
    const raw = parseCreditCountRaw(card);
    return raw ? Number(raw) : null;
  }

  function parseCreditExpiryLines(card) {
    const text = sourceCardText(card);
    const fragments = [];
    const patterns = [
      /(?:first|next|earliest)?\s*(?:reset\s+)?credits?[^.!?]*(?:expires|expire|expiring|expiration)[^.!?]*/gi,
      /(?:expires|expire|expiring|expiration)[^.!?]*/gi,
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const value = (match[0] || "").replace(/\s+/g, " ").trim();
        if (!value) continue;
        if (/^Use credits/i.test(value)) continue;
        if (!fragments.includes(value)) fragments.push(value);
      }
    }

    return fragments;
  }

  function evidenceKey(label) {
    return (
      String(label || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 120) || "usage-limit"
    );
  }

  function navigationType() {
    const entry = globalThis.performance
      ?.getEntriesByType?.("navigation")
      ?.[0];
    return typeof entry?.type === "string" ? entry.type : "unknown";
  }

  function extensionVersion() {
    try {
      return globalThis.chrome?.runtime?.getManifest?.().version || "unknown";
    } catch {
      return "unknown";
    }
  }

  function buildEvidenceObservation(now) {
    const usageCards = getEvidenceUsageCards();
    const candidateCards = getUsageCandidateCards();
    const creditCards = getCreditCards();
    const keyCounts = new Map();
    const limits = usageCards.map((card) => {
      const label = parseUsageLabel(card);
      const baseKey = evidenceKey(label);
      const occurrence = (keyCounts.get(baseKey) || 0) + 1;
      keyCounts.set(baseKey, occurrence);
      const key = occurrence === 1 ? baseKey : `${baseKey}-${occurrence}`;
      const remainingRaw = parseRemainingRaw(card);
      const resetRaw = parseResetText(card);
      const parsedReset = resetRaw ? parseResetDate(resetRaw, now) : null;
      return {
        key,
        label,
        remainingPercent: remainingRaw ? Number(remainingRaw.slice(0, -1)) : null,
        remainingRaw: remainingRaw || null,
        remainingPrecision: remainingPrecision(remainingRaw),
        reportedResetAtMs: parsedReset?.getTime() ?? null,
        resetRaw: resetRaw || null,
        resetStatus: resetRaw ? (parsedReset ? "reported" : "unparseable") : "missing",
        usedUnits: null,
        limitUnits: null,
        dataSource: "dom",
      };
    });

    const creditCounts = creditCards
      .map(parseCreditCount)
      .filter((value) => Number.isInteger(value));
    const creditCountRaw = creditCards
      .map(parseCreditCountRaw)
      .filter(Boolean)
      .join(" + ");
    const expiryRaw = [
      ...new Set(creditCards.flatMap((card) => parseCreditExpiryLines(card))),
    ];
    const credits = creditCards.length
      ? {
          count: creditCounts.length
            ? creditCounts.reduce((total, value) => total + value, 0)
            : null,
          countRaw: creditCountRaw || null,
          expiryRaw,
          dataSource: "dom",
        }
      : null;

    const outcome = limits.length
      ? "valid"
      : candidateCards.length
        ? "usage-parse-failure"
        : "no-usage-cards";
    return {
      checkedAtMs: now.getTime(),
      trigger: checkTrigger,
      navigationType: navigationType(),
      outcome,
      extensionVersion: extensionVersion(),
      timezoneOffsetMinutes: now.getTimezoneOffset(),
      articleCount: document.querySelectorAll("article").length,
      candidateCardCount: candidateCards.length,
      limitCount: limits.length,
      creditCardCount: creditCards.length,
      limits,
      credits,
    };
  }

  function annotateCreditCard(card) {
    card.querySelectorAll(`.${CREDIT_NOTE_CLASS}`).forEach((node) => node.remove());
    const count = parseCreditCount(card);
    const lines = parseCreditExpiryLines(card);
    const note = document.createElement("div");
    note.className = CREDIT_NOTE_CLASS;
    note.setAttribute(MANAGED_ATTR, "true");

    if (lines.length) {
      note.dataset.missing = "false";
      note.textContent = lines.join(" | ");
    } else if (count && count > 0) {
      note.dataset.missing = "true";
      note.textContent = "Expiration not visible in this page markup";
    } else {
      return;
    }

    card.appendChild(note);
  }

  function applyCardLayout(cards) {
    const groups = new Set();
    for (const card of cards) {
      card.classList.add(CARD_CLASS);
      if (card.parentElement) groups.add(card.parentElement);
    }

    for (const group of groups) {
      const groupCards = cards.filter((card) => card.parentElement === group);
      if (groupCards.length >= 2) group.classList.add(CARD_GROUP_CLASS);
    }
  }

  function formatClock(date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function calendarDayKey(date) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join("-");
  }

  function formatLocalDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDetectionTime(timestamp) {
    return formatClock(new Date(timestamp));
  }

  function formatShiftMinutes(value) {
    const rounded = Math.abs(value - Math.round(value)) < 0.01 ? Math.round(value) : value.toFixed(1);
    const number = Number(rounded);
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toLocaleString()} min`;
  }

  function formatCompactShiftMinutes(value) {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded.toLocaleString()}m`;
  }

  function formatRecordedPercent(value) {
    if (!Number.isFinite(value)) return "--%";
    const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : value.toFixed(1);
    return `${Number(rounded).toLocaleString()}%`;
  }

  function describeResetEvent(event) {
    const sourceNote =
      event.source === "provisional"
        ? "New prediction was provisional because weekly usage was 100%."
        : "New prediction was reported by Codex.";
    const reportedNote = event.reportedResetAtMs
      ? `\nFirst reported reset: ${formatLocalDateTime(event.reportedResetAtMs)}`
      : "";
    const remainingNote = Number.isFinite(event.remainingPercent)
      ? `${formatRecordedPercent(event.remainingPercent)} remaining`
      : "Not recorded for this older entry";
    return [
      `Detected: ${formatLocalDateTime(event.detectedAtMs)}`,
      `Old reset: ${formatLocalDateTime(event.oldResetAtMs)}`,
      `New reset: ${formatLocalDateTime(event.newResetAtMs)}`,
      `Reset-time jump: ${formatShiftMinutes(event.forwardDeltaMinutes)}`,
      `Remaining at detection: ${remainingNote}`,
      sourceNote,
    ].join("\n") + reportedNote;
  }

  function setCalendarMonthOffset(offset) {
    const cursor = calendarCursor || startOfMonth(new Date());
    calendarCursor = new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1);
    renderResetCalendar();
  }

  function ensureResetCalendar(cards) {
    if (!resetLogStorageReady || !resetLogState) return null;
    const cardGroup = cards[0]?.parentElement;
    if (!cardGroup) return null;

    let root = document.getElementById(RESET_CALENDAR_ID);
    if (!root) {
      root = document.createElement("section");
      root.id = RESET_CALENDAR_ID;
      root.setAttribute(MANAGED_ATTR, "true");
      root.setAttribute("aria-label", "Usage and quota evidence calendar");
      root.innerHTML = `
        <div class="codex-usage-pacer-calendar-header">
          <div class="codex-usage-pacer-calendar-heading">
            <h3>Usage and quota evidence</h3>
            <p class="codex-usage-pacer-calendar-meta"></p>
          </div>
          <div class="codex-usage-pacer-calendar-nav">
            <button type="button" data-calendar-action="previous" aria-label="Previous month">&lsaquo;</button>
            <span class="codex-usage-pacer-calendar-month" aria-live="polite"></span>
            <button type="button" data-calendar-action="next" aria-label="Next month">&rsaquo;</button>
            <button type="button" data-calendar-action="today">Today</button>
          </div>
        </div>
        <div class="codex-usage-pacer-calendar-scroll">
          <div class="codex-usage-pacer-calendar-weekdays" aria-hidden="true">
            ${WEEKDAYS.map((day) => `<div class="codex-usage-pacer-calendar-weekday">${day}</div>`).join("")}
          </div>
          <div class="codex-usage-pacer-calendar-days"></div>
        </div>
        <div class="codex-usage-pacer-calendar-details" aria-live="polite" hidden>
          <div class="codex-usage-pacer-calendar-details-header">
            <span class="codex-usage-pacer-calendar-details-date"></span>
            <span class="codex-usage-pacer-calendar-details-summary"></span>
          </div>
          <div class="codex-usage-pacer-calendar-detail-rows"></div>
        </div>
        <p class="codex-usage-pacer-calendar-empty"></p>
      `;

      root.querySelector('[data-calendar-action="previous"]').addEventListener("click", () => {
        setCalendarMonthOffset(-1);
      });
      root.querySelector('[data-calendar-action="next"]').addEventListener("click", () => {
        setCalendarMonthOffset(1);
      });
      root.querySelector('[data-calendar-action="today"]').addEventListener("click", () => {
        calendarCursor = startOfMonth(new Date());
        renderResetCalendar();
      });
    }

    if (root.previousElementSibling !== cardGroup) {
      cardGroup.insertAdjacentElement("afterend", root);
    }

    if (!calendarCursor) {
      const events = resetLogState.events || [];
      const samples = resetLogState.usageSamples || [];
      const checks = resetLogState.observationChecks || [];
      const evidenceChanges = resetLogState.evidenceChanges || [];
      const newestEvent = events.length ? events[events.length - 1] : null;
      const newestSample = samples.length ? samples[samples.length - 1] : null;
      const newestCheck = checks.length ? checks[checks.length - 1] : null;
      const newestEvidenceChange = evidenceChanges.length
        ? evidenceChanges[evidenceChanges.length - 1]
        : null;
      const newestTimestamp = Math.max(
        newestEvent?.detectedAtMs || 0,
        newestSample?.detectedAtMs || 0,
        newestCheck?.checkedAtMs || 0,
        newestEvidenceChange?.detectedAtMs || 0
      );
      calendarCursor = startOfMonth(new Date(newestTimestamp || Date.now()));
    }
    return root;
  }

  function formatElapsedTime(milliseconds) {
    const totalMinutes = Math.max(0, Math.round(milliseconds / (60 * 1000)));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes}m`;
    if (!minutes) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  function formatSignedPoints(value) {
    const rounded = Number(value.toFixed(2));
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded.toLocaleString()} pp`;
  }

  function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, String(value));
    }
    return element;
  }

  function usagePlotX(timestamp, dayStartMs, dayEndMs) {
    return clamp((timestamp - dayStartMs) / (dayEndMs - dayStartMs), 0, 1) * 100;
  }

  function usagePlotY(remainingPercent) {
    return 100 - clamp(remainingPercent, 0, 100);
  }

  function buildUsageChanges(samples, events) {
    if (!resetLogCore?.classifyUsageChange) return [];
    const changes = [];
    for (let index = 1; index < samples.length; index += 1) {
      const change = resetLogCore.classifyUsageChange(
        samples[index - 1],
        samples[index],
        events
      );
      if (change) changes.push(change);
    }
    return changes;
  }

  function createUsageTrace(dayStartMs, dayEndMs, renderEndMs, daySamples, carriedSample) {
    if (renderEndMs <= dayStartMs || (!carriedSample && !daySamples.length)) return null;

    const svg = createSvgElement("svg", {
      class: "codex-usage-pacer-usage-trace",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });
    for (const y of [0, 50, 100]) {
      svg.appendChild(
        createSvgElement("line", {
          class: "codex-usage-pacer-usage-grid",
          x1: 0,
          x2: 100,
          y1: y,
          y2: y,
        })
      );
    }

    const points = [];
    if (carriedSample) {
      points.push({
        x: 0,
        y: usagePlotY(carriedSample.remainingPercent),
        observedAtMs: carriedSample.detectedAtMs,
        carried: true,
      });
    }
    for (const sample of daySamples) {
      if (sample.detectedAtMs > renderEndMs) continue;
      points.push({
        x: usagePlotX(sample.detectedAtMs, dayStartMs, dayEndMs),
        y: usagePlotY(sample.remainingPercent),
        observedAtMs: sample.detectedAtMs,
        sample,
      });
    }
    if (!points.length) return null;

    const lastPoint = points[points.length - 1];
    const endX = usagePlotX(renderEndMs, dayStartMs, dayEndMs);
    if (endX > lastPoint.x) {
      points.push({
        x: endX,
        y: lastPoint.y,
        observedAtMs: renderEndMs,
        trailing: true,
      });
    }

    if (points.length > 1) {
      const path = [
        `M ${points[0].x.toFixed(2)} 100`,
        ...points.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
        `L ${points[points.length - 1].x.toFixed(2)} 100 Z`,
      ].join(" ");
      svg.appendChild(createSvgElement("path", { class: "codex-usage-pacer-usage-fill", d: path }));
    }

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const segment = createSvgElement("line", {
        class: "codex-usage-pacer-usage-segment",
        x1: previous.x.toFixed(2),
        y1: previous.y.toFixed(2),
        x2: current.x.toFixed(2),
        y2: current.y.toFixed(2),
      });
      segment.dataset.stale = String(
        Boolean(current.trailing) ||
          current.observedAtMs - previous.observedAtMs > USAGE_TRACE_STALE_AFTER_MS
      );
      svg.appendChild(segment);
    }

    for (const sample of daySamples) {
      if (sample.detectedAtMs > renderEndMs) continue;
      svg.appendChild(
        createSvgElement("circle", {
          class: "codex-usage-pacer-usage-dot",
          cx: usagePlotX(sample.detectedAtMs, dayStartMs, dayEndMs).toFixed(2),
          cy: usagePlotY(sample.remainingPercent).toFixed(2),
          r: 1.65,
        })
      );
    }
    return svg;
  }

  function describeUsageChange(change) {
    const resetNote = change.resetEventId
      ? "\nA reset timestamp also changed in this observation."
      : "";
    return [
      `Detected: ${formatLocalDateTime(change.detectedAtMs)}`,
      `Usage: ${formatRecordedPercent(change.previousRemainingPercent)} -> ${formatRecordedPercent(change.remainingPercent)} (${formatSignedPoints(change.deltaPoints)})`,
      `Since previous recorded change: ${formatElapsedTime(change.elapsedMs)}`,
    ].join("\n") + resetNote;
  }

  function describeCheck(check) {
    return [
      `Checked: ${formatLocalDateTime(check.checkedAtMs)}`,
      `Outcome: ${check.outcome}`,
      `Visible limits: ${check.limitCount}`,
      `Credit cards: ${check.creditCardCount}`,
      `Trigger: ${check.trigger}; navigation: ${check.navigationType}`,
      `Extension: ${check.extensionVersion}`,
    ].join("\n");
  }

  function evidenceValueSummary(entityType, value) {
    if (!value) return "missing";
    if (entityType === "credits") {
      const count = value.countRaw || (Number.isInteger(value.count) ? String(value.count) : "unknown");
      const expiry = value.expiryRaw?.length ? `; expiry: ${value.expiryRaw.join(" | ")}` : "";
      return `${count} credits${expiry}`;
    }

    const remaining = value.remainingRaw || "usage missing";
    const reset = value.resetRaw || `reset ${value.resetStatus || "missing"}`;
    const absolute =
      Number.isFinite(value.usedUnits) && Number.isFinite(value.limitUnits)
        ? `; ${value.usedUnits}/${value.limitUnits} units`
        : "";
    return `${remaining}; ${reset}${absolute}`;
  }

  function evidenceFieldLabel(change) {
    const fields = new Set(change.changedFields || []);
    const groups = [];
    if (fields.has("presence")) groups.push("presence");
    if (
      fields.has("remainingPercent") ||
      fields.has("remainingRaw") ||
      fields.has("remainingPrecision")
    ) {
      groups.push("usage");
    }
    if (
      fields.has("reportedResetAtMs") ||
      fields.has("resetRaw") ||
      fields.has("resetStatus")
    ) {
      groups.push("reset");
    }
    if (fields.has("count") || fields.has("countRaw")) groups.push("count");
    if (fields.has("expiryRaw")) groups.push("expiry");
    if (fields.has("usedUnits") || fields.has("limitUnits")) groups.push("capacity");
    if (fields.has("label")) groups.push("label");
    if (fields.has("dataSource")) groups.push("source");
    return groups.join(", ") || "changed";
  }

  function describeEvidenceChange(change) {
    return [
      `Detected: ${formatLocalDateTime(change.detectedAtMs)}`,
      `Last check: ${formatLocalDateTime(change.previousCheckAtMs)}`,
      `Changed: ${evidenceFieldLabel(change)}`,
      `Old: ${evidenceValueSummary(change.entityType, change.oldValue)}`,
      `New: ${evidenceValueSummary(change.entityType, change.newValue)}`,
      `Extension: ${change.extensionVersion}`,
    ].join("\n");
  }

  function createCalendarMarker(kind, timestamp, remainingPercent, dayStartMs, dayEndMs, title) {
    const marker = document.createElement("time");
    marker.className = "codex-usage-pacer-calendar-marker";
    marker.dataset.markerKind = kind;
    marker.dateTime = new Date(timestamp).toISOString();
    marker.style.left = `${clamp(usagePlotX(timestamp, dayStartMs, dayEndMs), 3, 97)}%`;
    marker.style.top = kind === "reset" ? "2%" : `${clamp(usagePlotY(remainingPercent), 4, 96)}%`;
    setInstantTooltip(marker, title);
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }

  function createCheckMarker(check, dayStartMs, dayEndMs) {
    const marker = createCalendarMarker(
      "check",
      check.checkedAtMs,
      0,
      dayStartMs,
      dayEndMs,
      describeCheck(check)
    );
    marker.style.top = "calc(100% - 4px)";
    return marker;
  }

  function createEvidenceMarker(change, dayStartMs, dayEndMs) {
    const marker = createCalendarMarker(
      "evidence",
      change.detectedAtMs,
      100,
      dayStartMs,
      dayEndMs,
      describeEvidenceChange(change)
    );
    marker.style.top = "28px";
    return marker;
  }

  function usageChangeLabel(kind) {
    return {
      "usage-increase": "Usage up",
      "usage-decrease": "Usage down",
    }[kind] || "Usage";
  }

  function renderCalendarDetails(root, selectedDay, previousSampleByTimestamp, changeByTimestamp) {
    const details = root.querySelector(".codex-usage-pacer-calendar-details");
    if (!selectedDay) {
      details.hidden = true;
      details.querySelector(".codex-usage-pacer-calendar-detail-rows").replaceChildren();
      return;
    }

    const entries = [];
    for (const sample of selectedDay.samples) {
      const previous = previousSampleByTimestamp.get(sample.detectedAtMs) || null;
      const change = changeByTimestamp.get(sample.detectedAtMs) || null;
      const delta = previous
        ? sample.remainingPercent - previous.remainingPercent
        : null;
      entries.push({
        timestamp: sample.detectedAtMs,
        kind: change?.kind || "usage",
        label: change ? usageChangeLabel(change.kind) : "Usage",
        value: formatRecordedPercent(sample.remainingPercent),
        note: previous
          ? `${formatRecordedPercent(previous.remainingPercent)} -> ${formatRecordedPercent(sample.remainingPercent)} (${formatSignedPoints(delta)}) after ${formatElapsedTime(sample.detectedAtMs - previous.detectedAtMs)}`
          : "First recorded weekly percentage",
      });
    }
    for (const event of selectedDay.events) {
      entries.push({
        timestamp: event.detectedAtMs,
        kind: "reset",
        label: "Reset",
        value: formatCompactShiftMinutes(event.forwardDeltaMinutes),
        note: `${formatRecordedPercent(event.remainingPercent)} remaining; moved to ${formatLocalDateTime(event.newResetAtMs)}`,
      });
    }
    for (const change of selectedDay.evidenceChanges) {
      entries.push({
        timestamp: change.detectedAtMs,
        kind: "evidence",
        label: change.entityType === "credits" ? "Credits" : "Limit",
        value: evidenceFieldLabel(change),
        note: `${change.label}: ${evidenceValueSummary(change.entityType, change.oldValue)} -> ${evidenceValueSummary(change.entityType, change.newValue)}; after ${formatElapsedTime(change.detectedAtMs - change.previousCheckAtMs)}`,
      });
    }
    for (const check of selectedDay.checks) {
      entries.push({
        timestamp: check.checkedAtMs,
        kind: "check",
        label: "Check",
        value: check.outcome === "valid" ? "Valid" : check.outcome,
        note: `${check.limitCount} limits, ${check.creditCardCount} credit cards; ${check.trigger}/${check.navigationType}; v${check.extensionVersion}`,
      });
    }
    entries.sort((a, b) => a.timestamp - b.timestamp || a.label.localeCompare(b.label));

    details.hidden = false;
    details.querySelector(".codex-usage-pacer-calendar-details-date").textContent =
      selectedDay.date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    const sampleLabel = `${selectedDay.samples.length} usage ${selectedDay.samples.length === 1 ? "change" : "changes"}`;
    const resetLabel = `${selectedDay.events.length} reset ${selectedDay.events.length === 1 ? "change" : "changes"}`;
    const checkLabel = `${selectedDay.checks.length} ${selectedDay.checks.length === 1 ? "check" : "checks"}`;
    const evidenceLabel = `${selectedDay.evidenceChanges.length} evidence ${selectedDay.evidenceChanges.length === 1 ? "change" : "changes"}`;
    details.querySelector(".codex-usage-pacer-calendar-details-summary").textContent =
      `${sampleLabel} | ${resetLabel} | ${checkLabel} | ${evidenceLabel}`;

    const rows = details.querySelector(".codex-usage-pacer-calendar-detail-rows");
    rows.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "codex-usage-pacer-calendar-detail-row";

      const time = document.createElement("time");
      time.className = "codex-usage-pacer-calendar-detail-time";
      time.dateTime = new Date(entry.timestamp).toISOString();
      time.textContent = formatDetectionTime(entry.timestamp);

      const kind = document.createElement("span");
      kind.className = "codex-usage-pacer-calendar-detail-kind";
      kind.dataset.kind = entry.kind;
      kind.textContent = entry.label;

      const value = document.createElement("span");
      value.className = "codex-usage-pacer-calendar-detail-value";
      value.textContent = entry.value;

      const note = document.createElement("span");
      note.className = "codex-usage-pacer-calendar-detail-note";
      note.textContent = entry.note;

      row.append(time, kind, value, note);
      rows.appendChild(row);
    }
  }

  function renderResetCalendar(cards = getCards()) {
    hideInstantTooltip();
    const root = ensureResetCalendar(cards);
    if (!root) return;

    const cursor = calendarCursor || startOfMonth(new Date());
    const events = [...(resetLogState.events || [])].sort((a, b) => a.detectedAtMs - b.detectedAtMs);
    const samples = [...(resetLogState.usageSamples || [])].sort(
      (a, b) => a.detectedAtMs - b.detectedAtMs
    );
    const checks = [...(resetLogState.observationChecks || [])].sort(
      (a, b) => a.checkedAtMs - b.checkedAtMs
    );
    const evidenceChanges = [...(resetLogState.evidenceChanges || [])].sort(
      (a, b) => a.detectedAtMs - b.detectedAtMs
    );
    const usageChanges = buildUsageChanges(samples, events);
    const eventsByDay = new Map();
    const samplesByDay = new Map();
    const changesByDay = new Map();
    const checksByDay = new Map();
    const evidenceChangesByDay = new Map();
    const previousSampleByTimestamp = new Map();
    const changeByTimestamp = new Map();

    for (const event of events) {
      const key = calendarDayKey(new Date(event.detectedAtMs));
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key).push(event);
    }
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const key = calendarDayKey(new Date(sample.detectedAtMs));
      if (!samplesByDay.has(key)) samplesByDay.set(key, []);
      samplesByDay.get(key).push(sample);
      if (index > 0) previousSampleByTimestamp.set(sample.detectedAtMs, samples[index - 1]);
    }
    for (const change of usageChanges) {
      const key = calendarDayKey(new Date(change.detectedAtMs));
      if (!changesByDay.has(key)) changesByDay.set(key, []);
      changesByDay.get(key).push(change);
      changeByTimestamp.set(change.detectedAtMs, change);
    }
    for (const check of checks) {
      const key = calendarDayKey(new Date(check.checkedAtMs));
      if (!checksByDay.has(key)) checksByDay.set(key, []);
      checksByDay.get(key).push(check);
    }
    for (const change of evidenceChanges) {
      const key = calendarDayKey(new Date(change.detectedAtMs));
      if (!evidenceChangesByDay.has(key)) evidenceChangesByDay.set(key, []);
      evidenceChangesByDay.get(key).push(change);
    }

    root.querySelector(".codex-usage-pacer-calendar-month").textContent = cursor.toLocaleDateString(
      undefined,
      { month: "long", year: "numeric" }
    );
    const usageCountLabel = `${samples.length.toLocaleString()} usage ${samples.length === 1 ? "change" : "changes"}`;
    const resetCountLabel = `${events.length.toLocaleString()} reset ${events.length === 1 ? "change" : "changes"}`;
    const checkCountLabel = `${checks.length.toLocaleString()} observation ${checks.length === 1 ? "check" : "checks"}`;
    const evidenceCountLabel = `${evidenceChanges.length.toLocaleString()} evidence ${evidenceChanges.length === 1 ? "change" : "changes"}`;
    const startedLabel = resetLogState.startedAtMs
      ? `Monitoring since ${formatLocalDateTime(resetLogState.startedAtMs)}`
      : "Monitoring starts with the first weekly observation";
    root.querySelector(".codex-usage-pacer-calendar-meta").textContent =
      `${usageCountLabel} | ${resetCountLabel} | ${checkCountLabel} | ${evidenceCountLabel} | ${startedLabel}`;

    const days = root.querySelector(".codex-usage-pacer-calendar-days");
    days.replaceChildren();
    const firstVisibleDate = new Date(cursor);
    firstVisibleDate.setDate(firstVisibleDate.getDate() - cursor.getDay());
    const firstVisibleMs = firstVisibleDate.getTime();
    const todayKey = calendarDayKey(new Date());
    const nowMs = Date.now();
    const visibleDays = new Map();
    let visibleRecordCount = 0;
    let carriedSample = null;
    for (const sample of samples) {
      if (sample.detectedAtMs >= firstVisibleMs) break;
      carriedSample = sample;
    }

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(firstVisibleDate);
      date.setDate(firstVisibleDate.getDate() + index);
      const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      const dayStartMs = date.getTime();
      const dayEndMs = nextDate.getTime();
      const key = calendarDayKey(date);
      const dayEvents = eventsByDay.get(key) || [];
      const daySamples = samplesByDay.get(key) || [];
      const dayChanges = changesByDay.get(key) || [];
      const dayChecks = checksByDay.get(key) || [];
      const dayEvidenceChanges = evidenceChangesByDay.get(key) || [];
      const hasDirectData =
        daySamples.length > 0 ||
        dayEvents.length > 0 ||
        dayChecks.length > 0 ||
        dayEvidenceChanges.length > 0;
      visibleRecordCount +=
        daySamples.length +
        dayEvents.length +
        dayChecks.length +
        dayEvidenceChanges.length;

      const day = document.createElement("div");
      day.className = "codex-usage-pacer-calendar-day";
      day.dataset.outside = String(date.getMonth() !== cursor.getMonth());
      day.dataset.hasData = String(hasDirectData);
      day.dataset.selected = String(selectedCalendarDayKey === key);
      if (key === todayKey) day.dataset.today = "true";

      const dateLabel = document.createElement("span");
      dateLabel.className = "codex-usage-pacer-calendar-date";
      dateLabel.textContent = String(date.getDate());
      day.appendChild(dateLabel);

      const plot = document.createElement("div");
      plot.className = "codex-usage-pacer-calendar-plot";
      const trace = createUsageTrace(
        dayStartMs,
        dayEndMs,
        Math.min(dayEndMs, nowMs),
        daySamples,
        carriedSample
      );
      if (trace) plot.appendChild(trace);

      for (const event of dayEvents) {
        const marker = createCalendarMarker(
          "reset",
          event.detectedAtMs,
          event.remainingPercent,
          dayStartMs,
          dayEndMs,
          describeResetEvent(event)
        );
        const hue = resetLogCore.shiftHue(event.forwardDeltaMinutes, RESET_LOG_GREEN_MINUTES);
        marker.style.setProperty("--codex-reset-shift-hue", String(hue));
        plot.appendChild(marker);
      }
      for (const change of dayChanges) {
        plot.appendChild(
          createCalendarMarker(
            change.kind,
            change.detectedAtMs,
            change.remainingPercent,
            dayStartMs,
            dayEndMs,
            describeUsageChange(change)
          )
        );
      }
      for (const change of dayEvidenceChanges) {
        plot.appendChild(createEvidenceMarker(change, dayStartMs, dayEndMs));
      }
      for (const check of dayChecks) {
        plot.appendChild(createCheckMarker(check, dayStartMs, dayEndMs));
      }
      if (plot.childNodes.length) day.appendChild(plot);

      const dateDescription = date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const sampleDescription = `${daySamples.length} recorded usage ${daySamples.length === 1 ? "change" : "changes"}`;
      const resetDescription = `${dayEvents.length} reset-time ${dayEvents.length === 1 ? "change" : "changes"}`;
      const checkDescription = `${dayChecks.length} observation ${dayChecks.length === 1 ? "check" : "checks"}`;
      const evidenceDescription = `${dayEvidenceChanges.length} evidence ${dayEvidenceChanges.length === 1 ? "change" : "changes"}`;
      day.setAttribute(
        "aria-label",
        `${dateDescription}: ${sampleDescription}, ${resetDescription}, ${checkDescription}, ${evidenceDescription}`
      );
      if (hasDirectData) {
        day.tabIndex = 0;
        day.setAttribute("role", "button");
        const selectDay = () => {
          selectedCalendarDayKey = selectedCalendarDayKey === key ? null : key;
          renderResetCalendar();
        };
        day.addEventListener("click", selectDay);
        day.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectDay();
        });
      }

      visibleDays.set(key, {
        date,
        events: dayEvents,
        samples: daySamples,
        changes: dayChanges,
        checks: dayChecks,
        evidenceChanges: dayEvidenceChanges,
      });
      days.appendChild(day);
      if (daySamples.length) carriedSample = daySamples[daySamples.length - 1];
    }

    renderCalendarDetails(
      root,
      selectedCalendarDayKey ? visibleDays.get(selectedCalendarDayKey) || null : null,
      previousSampleByTimestamp,
      changeByTimestamp
    );
    const empty = root.querySelector(".codex-usage-pacer-calendar-empty");
    empty.hidden = visibleRecordCount > 0;
    empty.textContent = visibleRecordCount
      ? ""
      : "No usage or reset changes detected in this calendar view.";
  }

  function persistResetLogState() {
    if (!resetLogState || persistQueued) return;
    persistQueued = true;
    queueMicrotask(() => {
      persistQueued = false;
      persistResetLogStateNow();
    });
  }

  function persistResetLogStateNow() {
    if (!resetLogState) return;
    if (!hasExtensionContext()) {
      retireInvalidatedInstance();
      return;
    }
    if (!globalThis.chrome?.storage?.local) return;
    try {
      const result = globalThis.chrome.storage.local.set({
        [RESET_LOG_STORAGE_KEY]: resetLogState,
      });
      result?.catch?.((error) => {
        handleStorageError("save", error);
      });
    } catch (error) {
      handleStorageError("save", error);
    }
  }

  function processEvidenceObservation(observation) {
    if (!resetLogCore?.processEvidenceObservation || !observation) return;
    if (!resetLogStorageReady) {
      pendingEvidenceObservation = observation;
      return;
    }

    const result = resetLogCore.processEvidenceObservation(resetLogState, {
      ...observation,
      trigger: checkTrigger,
    });
    if (!result.changed) return;

    resetLogState = result.state;
    persistResetLogState();
    renderResetCalendar();
  }

  function processWeeklyResetObservation(observation) {
    if (!resetLogCore || !observation) return;
    if (!resetLogStorageReady) {
      pendingWeeklyObservation = observation;
      return;
    }

    const result = resetLogCore.processWeeklyObservation(resetLogState, observation);
    if (!result.changed) return;

    resetLogState = result.state;
    if (result.event) {
      calendarCursor = startOfMonth(new Date(result.event.detectedAtMs));
    }
    persistResetLogState();
    renderResetCalendar();
  }

  async function loadResetLogState() {
    if (!resetLogCore) {
      resetLogStorageReady = true;
      return;
    }
    if (!hasExtensionContext()) {
      retireInvalidatedInstance();
      return;
    }

    try {
      const stored = globalThis.chrome?.storage?.local
        ? await globalThis.chrome.storage.local.get([
            RESET_LOG_STORAGE_KEY,
            FOCUS_RELOAD_MARKER_KEY,
          ])
        : {};
      resetLogState = resetLogCore.normalizeState(stored?.[RESET_LOG_STORAGE_KEY]);
      const focusMarkerAtMs = stored?.[FOCUS_RELOAD_MARKER_KEY];
      if (
        Number.isFinite(focusMarkerAtMs) &&
        Date.now() - focusMarkerAtMs >= 0 &&
        Date.now() - focusMarkerAtMs <= 60 * 1000
      ) {
        checkTrigger = "focus";
      } else {
        checkTrigger = navigationType() === "navigate" ? "initial" : navigationType();
      }
      if (Number.isFinite(focusMarkerAtMs)) {
        globalThis.chrome.storage.local
          .remove(FOCUS_RELOAD_MARKER_KEY)
          .catch((error) => handleStorageError("clear the focus marker from", error));
      }
    } catch (error) {
      if (handleStorageError("load", error)) return;
      resetLogState = resetLogCore.normalizeState(null);
    }

    resetLogStorageReady = true;
    if (pendingWeeklyObservation) {
      const observation = pendingWeeklyObservation;
      pendingWeeklyObservation = null;
      processWeeklyResetObservation(observation);
    }
    if (pendingEvidenceObservation) {
      const observation = pendingEvidenceObservation;
      pendingEvidenceObservation = null;
      processEvidenceObservation(observation);
    }
    renderResetCalendar();
  }

  function appendTick(fragment, leftPercent, labelText, titleText, kind) {
    const tick = document.createElement("div");
    tick.className = "codex-usage-pacer-tick";
    tick.style.left = `${clamp(leftPercent, 0, 100)}%`;
    if (leftPercent <= 2) tick.dataset.edge = "start";
    if (leftPercent >= 98) tick.dataset.edge = "end";
    if (kind) tick.dataset.kind = kind;
    if (titleText) setInstantTooltip(tick, titleText);
    const label = document.createElement("span");
    label.textContent = labelText;
    tick.appendChild(label);
    fragment.appendChild(tick);
  }

  function buildFiveHourTicks(startDate, resetDate) {
    const fragment = document.createDocumentFragment();
    appendTick(fragment, 0, formatClock(startDate));
    for (let i = 1; i <= 5; i += 1) {
      const tickDate = new Date(startDate.getTime() + i * HOUR_MS);
      const elapsedPercent = ((tickDate.getTime() - startDate.getTime()) / (resetDate.getTime() - startDate.getTime())) * 100;
      appendTick(fragment, elapsedPercent, formatClock(tickDate));
    }
    return fragment;
  }

  function buildWeeklyTicks(startDate, resetDate) {
    const fragment = document.createDocumentFragment();
    const tickDate = new Date(startDate);
    tickDate.setHours(24, 0, 0, 0);

    while (tickDate.getTime() < resetDate.getTime()) {
      const elapsedPercent = ((tickDate.getTime() - startDate.getTime()) / (resetDate.getTime() - startDate.getTime())) * 100;
      appendTick(fragment, elapsedPercent, WEEKDAYS[tickDate.getDay()], `${WEEKDAYS[tickDate.getDay()]} 00:00`);
      tickDate.setDate(tickDate.getDate() + 1);
    }

    appendTick(fragment, 100, formatClock(resetDate), `${WEEKDAYS[resetDate.getDay()]} ${formatClock(resetDate)} reset`, "reset");
    return fragment;
  }

  function annotateCard(card, now) {
    cleanupUsageCard(card);

    const text = (card.textContent || "").replace(/\s+/g, " ").trim();
    const isFiveHour = /^5 hour usage limit/.test(text);
    const isWeekly = /^Weekly usage limit/.test(text);
    if (!isFiveHour && !isWeekly) return;

    const remaining = parseRemaining(card);
    const resetText = parseResetText(card);
    const progressBar = findProgressBar(card);
    const resetRow = findResetRow(card);
    const remainingRow = findRemainingRow(card);
    if (!progressBar || !remainingRow) return;

    const windowMs = isFiveHour ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const isFullWindow = remaining !== null && remaining >= 99.5;

    const resetDate = isFullWindow
      ? new Date(now.getTime() + windowMs)
      : parseResetDate(resetText, now);
    if (!resetDate) return;

    if (isFullWindow) {
      card.removeAttribute(RESET_TEXT_ATTR);
      resetRow?.removeAttribute(RESET_ROW_ATTR);
    } else if (resetText && resetRow) {
      card.setAttribute(RESET_TEXT_ATTR, resetText);
      resetRow.setAttribute(RESET_ROW_ATTR, "true");
    }

    const startMs = isFullWindow ? now.getTime() : resetDate.getTime() - windowMs;
    const elapsed = clamp((now.getTime() - startMs) / windowMs, 0, 1);
    const idealRemaining = clamp((1 - elapsed) * 100, 0, 100);

    progressBar.classList.add(PROGRESS_CLASS);
    progressBar.setAttribute(PROGRESS_ATTR, "true");
    progressBar.style.overflow = "visible";
    const overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute(MANAGED_ATTR, "true");
    overlay.appendChild(isFiveHour ? buildFiveHourTicks(new Date(startMs), resetDate) : buildWeeklyTicks(new Date(startMs), resetDate));

    const marker = document.createElement("div");
    marker.className = "codex-usage-pacer-marker";
    marker.style.left = `${elapsed * 100}%`;
    setInstantTooltip(marker, `Now: even pace ${idealRemaining.toFixed(0)}% remaining`);
    overlay.appendChild(marker);
    progressBar.appendChild(overlay);

    const target = document.createElement("span");
    target.className = TARGET_CLASS;
    target.setAttribute(MANAGED_ATTR, "true");
    target.textContent = `(target ${idealRemaining.toFixed(0)}%)`;
    remainingRow.appendChild(target);

    if (resetRow) {
      resetRow.querySelectorAll(`.${OLD_SUMMARY_CLASS}`).forEach((node) => node.remove());
      resetRow.textContent = "";
    }

    return isWeekly
      ? {
          observedAtMs: now.getTime(),
          predictedResetAtMs: resetDate.getTime(),
          source: isFullWindow ? "provisional" : "reported",
          isFull: isFullWindow,
          remainingPercent: remaining,
        }
      : null;
  }

  function maybeCaptureEvidenceObservation(now, force = false) {
    if (evidenceObservationCaptured) return;
    if (!force) {
      if (getEvidenceUsageCards().length === 0) return;
      if (evidenceSettleTimer !== null) window.clearTimeout(evidenceSettleTimer);
      evidenceSettleTimer = window.setTimeout(() => {
        evidenceSettleTimer = null;
        maybeCaptureEvidenceObservation(new Date(), true);
      }, EVIDENCE_CAPTURE_SETTLE_MS);
      return;
    }

    evidenceObservationCaptured = true;
    if (evidenceCaptureTimer !== null) {
      window.clearTimeout(evidenceCaptureTimer);
      evidenceCaptureTimer = null;
    }
    if (evidenceSettleTimer !== null) {
      window.clearTimeout(evidenceSettleTimer);
      evidenceSettleTimer = null;
    }
    processEvidenceObservation(buildEvidenceObservation(now));
  }

  function annotate() {
    if (destroyed) return;
    if (!hasExtensionContext()) {
      retireInvalidatedInstance();
      return;
    }
    installStyle();
    const now = new Date();
    maybeCaptureEvidenceObservation(now);
    const cards = getCards();
    applyCardLayout(cards);
    let weeklyObservation = null;
    for (const card of cards) {
      weeklyObservation = annotateCard(card, now) || weeklyObservation;
    }
    for (const card of getCreditCards()) annotateCreditCard(card);
    if (weeklyObservation && !weeklyObservationCaptured) {
      weeklyObservationCaptured = true;
      processWeeklyResetObservation(weeklyObservation);
    }
    renderResetCalendar(cards);
  }

  let scheduled = false;
  function scheduleAnnotate() {
    if (scheduled || destroyed) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      annotate();
    });
  }

  function markAway() {
    sawAway = true;
    lastAwayAt = Date.now();
  }

  function maybeReloadOnFocus() {
    if (document.hidden || !sawAway || focusReloadPending) return;

    const now = Date.now();
    if (lastAwayAt && now - lastAwayAt < FOCUS_RELOAD_AWAY_MIN_MS) return;

    sawAway = false;
    focusReloadPending = true;
    const reload = () => {
      if (!destroyed) window.location.reload();
    };
    if (!globalThis.chrome?.storage?.local) {
      reload();
      return;
    }
    try {
      Promise.resolve(
        globalThis.chrome.storage.local.set({
          [FOCUS_RELOAD_MARKER_KEY]: now,
        })
      )
        .catch((error) => {
          handleStorageError("mark the focus reload in", error);
        })
        .finally(reload);
    } catch (error) {
      handleStorageError("mark the focus reload in", error);
      reload();
    }
  }

  function handlePageShow(event) {
    if (event.persisted) maybeReloadOnFocus();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      markAway();
    } else {
      maybeReloadOnFocus();
    }
  }

  window.addEventListener("blur", markAway);
  window.addEventListener("focus", maybeReloadOnFocus);
  window.addEventListener("pagehide", markAway);
  window.addEventListener("pageshow", handlePageShow);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pointerover", handleTooltipPointerOver);
  document.addEventListener("pointermove", handleTooltipPointerMove);
  document.addEventListener("pointerout", handleTooltipPointerOut);
  document.addEventListener("focusin", handleTooltipFocusIn);
  document.addEventListener("focusout", handleTooltipFocusOut);

  observer = new MutationObserver((mutations) => {
    const hasPageNode = mutations.some((m) =>
      [...m.addedNodes].some((n) => n.nodeType === Node.ELEMENT_NODE && !isManagedNode(n))
    );
    if (hasPageNode) {
      scheduleAnnotate();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window[INSTANCE_KEY] = {
    destroy: destroyInstance,
  };

  evidenceCaptureTimer = window.setTimeout(() => {
    evidenceCaptureTimer = null;
    maybeCaptureEvidenceObservation(new Date(), true);
  }, EVIDENCE_CAPTURE_FALLBACK_MS);
  loadResetLogState();
  annotate();
})();
