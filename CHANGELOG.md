# Changelog

All notable changes to Codex Usage Pacer are documented here.

## [0.12.0] - 2026-10-06

Includes the unreleased 0.9.3 to 0.11.0 work.

### Added

- Support for the redesigned Usage settings page at
  `https://chatgpt.com/settings/usage`: settings rows, native progress bars,
  `Weekly limit`, `% left`, and the new credit balance group. The legacy
  Analytics route still works, and the content script runs on those two routes only.
- Exact reset times read from the native countdown tooltip, including seconds
  and timezone. Rounded countdowns are never converted into timestamps.
- A credit-expiration table below the credit balance, backed by an optional
  local ledger editor. Dated grants are grouped by expiration date, unassigned
  credits stay in a **Date unknown** row, and optional source URLs link each
  date to its receipt or announcement. Because the page exposes only a combined
  balance, the split is labeled as an estimate (earliest-expiring grant debited
  first).
- A credit-balance history graph with 24-hour, 7-day, 30-day, and all-history
  views, instant point details, and an estimated daily decline. The selected
  range is remembered locally.
- An estimate of the credit balance as a share of one Pro 20x week, using a
  provisional 55,000-credit denominator linked to its community source.
- Links to Codex Reset Monitor, Claude Reset Tracker, and OpenAI status below
  the weekly usage bar. They are manual links only, with no extra requests.
- A **Reload extension** button beside the calendar's month controls, for
  unpacked installs.

### Fixed

- Credit balances with thousands separators are recorded correctly (`33,564`
  is 33564, not 33), and decimal balances keep their exact displayed value.
- Joined labels such as `Credits remaining33,564` no longer drop credit
  observations.
- The reported reset time wins even at 100% remaining.
- The new Analytics subview no longer logs a missing balance just because it is
  not the Overview tab.

### Changed

- Existing history, credit-expiration entries, and graph preferences carry
  over unchanged.
- Release packaging now reads its file list from `manifest.json` and includes
  the Lucide icon license. `npm test` runs every `*.test.js` suite.

## [0.9.2] - 2026-09-07

### Added

- Linked public reset forecasts from Codex Reset Monitor, with separate links
  to source announcements and immediate probability/provenance tooltips.
- High-confidence announcement markers on the weekly usage bar, including a
  range when the stated Pacific timezone is ambiguous.
- Event-driven forecast fetching on page load and focus-triggered refresh,
  with a short-lived local cache and no timer-based background polling.
- Forecast parsing and service-worker tests, plus a standalone browser fixture
  for announcement, probability-only, and narrow-card layouts.

### Fixed

- Forecasts never change the official reset date, pacing target, or usage log.
- Probability windows no longer produce invented exact reset times.
- "Today" and "tomorrow" use the source post's date and timezone, not the
  refresh date. Passed, superseded, and historical announcements are handled
  without silently moving their dates forward.
- Forecast labels wrap inside narrow usage cards.
- Release packaging includes the forecast parser and background service worker.

### Changed

- Documented GitHub installation and updates without a Chrome Web Store step.
- Updated privacy and permission disclosures for the public forecast request.

## [0.8.0] - 2026-07-23

### Added

- Exact-value weekly usage and reset-time change logging.
- Focus-triggered observation coverage without background polling.
- Generic evidence capture for visible quota and reset-credit cards.
- Daily calendar traces, reset markers, and immediate tooltips.
- Recovery from invalidated content-script contexts after extension reloads.
- Public release packaging, privacy documentation, and automated checks.
