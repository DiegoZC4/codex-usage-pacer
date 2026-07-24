# Chrome Web Store Listing

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
calendar, reset-time changes, and observation coverage.

The extension reads and locally stores only what the signed-in dashboard
visibly reports: quota labels, remaining percentages, reset dates and times,
reset-credit counts and visible expiration text, parser status, and the local
time of each check. It checks after the page loads and when the tab or window
returns to focus. It does not poll in the background, infer hidden capacity, or
require a companion server.

All observations stay in Chrome's local extension storage. There are no ads,
analytics SDKs, remote code, or extension-initiated network requests.

This is an unofficial community project and is not affiliated with or endorsed
by OpenAI.

## Single purpose

Annotate the Codex usage dashboard and preserve a local history of the quota
and reset information displayed there.

## Permission justifications

**storage**

Stores bounded local histories for usage changes, reset-time changes,
observation coverage, visible quota evidence, and the focus-refresh marker.

**Host access: chatgpt.com/codex/cloud/settings/analytics**

Runs the content script only on the Codex usage dashboard so it can read and
annotate the quota information rendered on that page.

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

Data is not sold, used for advertising or creditworthiness, or transferred to
third parties. It is used only for the extension's single stated purpose.

## URLs

- Homepage: https://github.com/DiegoZC4/codex-usage-pacer
- Support: https://github.com/DiegoZC4/codex-usage-pacer/issues
- Privacy policy:
  https://github.com/DiegoZC4/codex-usage-pacer/blob/main/PRIVACY.md

## Distribution

Use **Unlisted** visibility for the first release. Anyone with the Store link
can install it and receive updates, but the item will not appear in public
search results.

## Reviewer notes

1. Sign in to ChatGPT with an account that has access to Codex.
2. Open `https://chatgpt.com/codex/cloud/settings/analytics`.
3. The extension annotates visible usage cards and adds the local calendar.
4. Switch away from the tab and return to demonstrate the focus-triggered
   refresh.

No test credentials are bundled with the extension.
