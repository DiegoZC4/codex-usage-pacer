# Privacy Policy

Effective date: October 6, 2026

Codex Usage Pacer keeps usage observations locally. It does not operate a
companion server, include advertising or analytics SDKs, or sell or transmit
stored observations. It makes an event-driven request for public reset
forecasts, described below.

## Data the extension reads

When the user opens the Codex usage page at `https://chatgpt.com/settings/usage`
or the legacy dashboard at `https://chatgpt.com/codex/cloud/settings/analytics`,
the extension reads the quota information rendered on that page. Depending on what the page exposes,
this can include:

- Usage-limit labels and remaining percentages.
- Displayed reset dates and times.
- Reset-credit counts and visible expiration text.
- Displayed credit balances.
- Whether expected quota fields appeared and could be parsed.
- The local date and time when the page was checked.

The extension also fetches `https://codexreset.org/` to read the monitor's public
probabilities, source-post links, announcement times, and freshness information.
Only a structured forecast snapshot, including a short timing phrase, is cached;
the full fetched HTML and full post text are not stored.

The extension does not read ChatGPT conversation contents, prompts, responses,
passwords, payment information, browsing history, or arbitrary pages you visit.

## Data you enter

The optional credit-expiration ledger stores what you type into it: credit
amounts, expiration dates, and optional source links. The extension also
remembers which credit-history range you last selected. This information stays
in the extension's local storage like the observations above.

## How data is used

The data is used only to annotate the dashboard, plot local history, show
observation coverage, identify changes between visits, and display separately
sourced forecasts. Forecasts do not alter the official pacing calculation.

## Storage and retention

Observations are stored on the user's device with `chrome.storage.local`.
Percentage, reset, check, and generic evidence histories are each capped at the
newest 20,000 entries. Chrome manages the extension's local storage and removes
it when the extension is uninstalled, subject to Chrome's own behavior and
device policies. The forecast cache holds one structured snapshot. A failed
request can reuse it for at most two hours; stale monitor forecasts are omitted
from the display, even if their cached snapshot remains in storage.

## Sharing and transmission

The extension does not send stored observations to the developer, OpenAI,
GitHub, or any other third party. It does not use remote code.

After dashboard loads and focus-triggered refreshes, the extension requests the
public monitor page without cookies or credentials. No stored observations,
quota percentages, ChatGPT credentials, or account identifiers are included in
that request. As with any web request, the monitor's hosting infrastructure
receives ordinary connection metadata, including your IP address and browser
request headers. The extension does not control that third party's handling of
request metadata.

Source links open only when you click them, using the browser's normal behavior.
The underlying Codex dashboard continues to communicate with OpenAI as it
normally would. There is no timer-based background polling.

## Chrome Web Store Limited Use

Codex Usage Pacer's use of information received through Chrome adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements. The
extension uses the dashboard observations only to provide and improve its
user-facing pacing and local-history features. It does not transfer the data,
use it for advertising or creditworthiness, or permit humans to read it.

## Permissions

- `storage`: saves the local histories and focus-refresh marker described above.
- Access to `https://chatgpt.com/settings/usage*` and
  `https://chatgpt.com/codex/cloud/settings/analytics*`: lets the content script
  read and annotate only the Codex usage page and the legacy dashboard.
- Host permission for `https://codexreset.org/*`: lets the event-driven service
  worker fetch the public forecast without page-origin CORS restrictions.

## Changes

Material changes to this policy will be documented in the repository and
included with the corresponding extension release.

## Contact

Questions and privacy requests can be filed through the project's
[GitHub issue tracker](https://github.com/DiegoZC4/codex-usage-pacer/issues).
