# Privacy Policy

Effective date: July 23, 2026

Codex Usage Pacer is a local-only browser extension. It does not operate a
server, include advertising or analytics SDKs, or sell or transmit user data.

## Data the extension reads

When the user opens the Codex usage dashboard at
`https://chatgpt.com/codex/cloud/settings/analytics`, the extension reads the
quota information rendered on that page. Depending on what the page exposes,
this can include:

- Usage-limit labels and remaining percentages.
- Displayed reset dates and times.
- Reset-credit counts and visible expiration text.
- Whether expected quota fields appeared and could be parsed.
- The local date and time when the page was checked.

The extension does not read ChatGPT conversation contents, prompts, responses,
passwords, payment information, or pages outside the specified Codex Analytics
URL.

## How data is used

The data is used only to annotate the dashboard, plot local history, show
observation coverage, and identify changes between visits.

## Storage and retention

Observations are stored on the user's device with `chrome.storage.local`.
Percentage, reset, check, and generic evidence histories are each capped at the
newest 20,000 entries. Chrome manages the extension's local storage and removes
it when the extension is uninstalled, subject to Chrome's own behavior and
device policies.

## Sharing and transmission

The extension does not send stored observations to the developer, OpenAI,
GitHub, or any other third party. It does not use remote code or make its own
network requests. The underlying Codex dashboard continues to communicate with
OpenAI as it normally would.

## Chrome Web Store Limited Use

Codex Usage Pacer's use of information received through Chrome adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements. The
extension uses the dashboard observations only to provide and improve its
user-facing pacing and local-history features. It does not transfer the data,
use it for advertising or creditworthiness, or permit humans to read it.

## Permissions

- `storage`: saves the local histories and focus-refresh marker described above.
- Access to `https://chatgpt.com/codex/cloud/settings/analytics*`: lets the
  content script read and annotate only the Codex usage dashboard.

## Changes

Material changes to this policy will be documented in the repository and
included with the corresponding extension release.

## Contact

Questions and privacy requests can be filed through the project's
[GitHub issue tracker](https://github.com/DiegoZC4/codex-usage-pacer/issues).
