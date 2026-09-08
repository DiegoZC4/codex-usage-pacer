# Changelog

All notable changes to Codex Usage Pacer are documented here.

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
