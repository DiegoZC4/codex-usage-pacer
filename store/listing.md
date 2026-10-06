# Chrome Web Store Listing

This is reference copy only. Current releases are distributed through GitHub;
publishing a GitHub release does not submit an extension or update to the Store.

## Product details

**Name:** Codex Usage Pacer

**Summary:** Local pacing markers and usage history for the Codex usage
dashboard.

**Category:** Productivity

**Language:** English

**Store icon:** `icons/icon-128.png`

**Screenshot:** `store/screenshot-1280x800.png` (representative data)

## Detailed description

Codex Usage Pacer adds an evidence-focused overlay to the Codex usage
dashboard. It shows even-pace targets, clearer time axes, a daily usage
calendar, reset-time changes, and observation coverage. Separately linked public
reset forecasts show their probability windows and source announcements without
changing the official pacing target.

The extension reads and locally stores only what the signed-in dashboard
visibly reports: quota labels, remaining percentages, reset dates and times,
reset-credit counts and visible expiration text, parser status, and the local
time of each check. It checks after the page loads and when the tab or window
returns to focus. It does not poll in the background, infer hidden capacity, or
require a companion server.

All observations stay in Chrome's local extension storage. There are no ads,
analytics SDKs, or remote code. An event-driven request fetches public reset
forecasts from codexreset.org without cookies or stored usage information.
The monitor's host receives ordinary request metadata, such as the IP address.

This is an unofficial community project and is not affiliated with or endorsed
by OpenAI.

## Single purpose

Annotate the Codex usage dashboard and preserve a local history of the quota
and reset information displayed there.

## Permission justifications

**storage**

Stores bounded local histories for usage changes, reset-time changes,
observation coverage, visible quota evidence, and the focus-refresh marker, plus
optional credit-expiration entries and the selected credit-history range.

**Host access: chatgpt.com/settings/usage and chatgpt.com/codex/cloud/settings/analytics**

Runs the content script only on the Codex usage page and its legacy dashboard
route so it can read and annotate the quota information rendered there.

**Host access: codexreset.org**

Fetches the public reset forecast when the matched dashboard requests it.
The worker does not poll and sends no usage history or account credentials.

## Data-use disclosure

- Website content: **Yes, locally only.** The extension reads visible quota
  labels, percentages, reset times, and reset-credit text on the matched page.
- Personally identifiable information: **No.**
- Authentication information: **No.**
- Financial and payment information: **No.**
- Personal communications: **No.**
- Location: **No.**
- Web history: **No.** The extension neither reads Chrome history nor stores a
  list of visited URLs.
- User activity: **No cross-site tracking.** It stores local timestamps for
  checks of the single matched dashboard solely to describe observation
  coverage.

Stored observations are not sold, used for advertising or creditworthiness, or
transferred to third parties. They are used only for the extension's single
stated purpose. Public forecast requests expose ordinary request metadata to
the monitor's host as documented in the privacy policy.

## URLs

- Homepage: https://github.com/DiegoZC4/codex-usage-pacer
- Support: https://github.com/DiegoZC4/codex-usage-pacer/issues
- Privacy policy:
  https://github.com/DiegoZC4/codex-usage-pacer/blob/main/PRIVACY.md

## Distribution

Use GitHub releases and unpacked installation. This file does not imply that a
Chrome Web Store listing has been submitted, reviewed, or published.

## Reviewer notes

1. Sign in to ChatGPT with an account that has access to Codex.
2. Open `https://chatgpt.com/settings/usage` (or the legacy
   `https://chatgpt.com/codex/cloud/settings/analytics`).
3. The extension annotates visible usage cards and adds the local calendar.
4. Switch away from the tab and return to demonstrate the focus-triggered
   refresh.

No test credentials are bundled with the extension.
