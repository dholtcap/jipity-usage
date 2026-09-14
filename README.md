# Jipity Usage

A small Chromium/Brave extension for tracking the weekly ChatGPT/Codex usage limit and whether your current pace will make it to the reset.

It works in two places:

- **ChatGPT → Settings → Usage** — adds pace calculations under the existing weekly-limit card.
- **Browser toolbar popup** — click the extension from any site to see live usage, pace, projection, detailed history, and rolling usage-rate charts.

## v0.4 dashboard

Version 0.4 adds:

- Faster popup refreshes by reusing a valid cached ChatGPT session token instead of calling `/api/auth/session` before every usage request. If cached auth expires, the extension automatically refreshes it and retries once.
- A more literal weekly usage chart:
  - one-minute local observations are preserved;
  - cumulative usage is drawn as a **step chart** rather than smoothed into a low-resolution-looking line;
  - detected usage changes are marked on the line;
  - hover shows the exact local timestamp and observed usage percentage;
  - unobserved history from before local tracking began is shown separately rather than pretending it is measured data.
- A second **usage-rate chart** that shows how `% / hour` changes over time.
- Rolling-rate controls for **30 minutes**, **1 hour**, and **3 hours**.
- Current and peak rolling-rate readouts plus an even-weekly-pace reference line.
- Semantic status colors:
  - **Green** — projected usage is comfortably below the weekly limit.
  - **Amber** — projected usage is close to 100% at reset.
  - **Red** — current average pace would hit the limit before reset.

## Why many snapshots can still show only a few usage changes

The extension samples the ChatGPT usage endpoint about once per minute. That can produce hundreds of observations, but many consecutive samples can contain the same `used_percent` value because ChatGPT's usage service may report that percentage at a coarser granularity than the sampling interval.

Version 0.4 distinguishes **observations** from **detected usage changes** so the chart no longer implies that hundreds of snapshots necessarily mean hundreds of distinct usage values.

## Metrics

The extension shows:

- **Used %** and **remaining %**
- **Average usage rate (% per hour)**
- **30m / 1h / 3h rolling usage rate**
- **How far over/under an even weekly pace you are**
- **Safe rate from now until reset**
- **Projected usage at reset**
- **Reset countdown** and exact local reset time
- **Projected buffer** or estimated time the limit would be exhausted early

## Install in Brave

1. Clone or download this repository.
2. Open `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder (the folder containing `manifest.json`).
6. Make sure you are signed in to `chatgpt.com`.

To update an already-loaded development copy after pulling new files, return to `brave://extensions` and click **Reload** on the extension card.

## Live popup

When you click the extension icon it:

1. Shows the most recently cached usage immediately, if available.
2. Reuses a valid cached ChatGPT session token when possible.
3. Resolves the active ChatGPT account/workspace ID when available.
4. Fetches the current usage response from ChatGPT.
5. Recalculates pace using the exact weekly reset timestamp.
6. Records a small local history sample for the charts.
7. Refreshes every 30 seconds while the popup is open. A background refresh also runs once per minute.

This means the popup works even when your active tab is not on ChatGPT.

History samples are stored only in `chrome.storage.local` and retained only for the active weekly window.

## Calculation

For a 7-day / 168-hour weekly window:

- `used % = 100 - remaining %`
- `average rate = used % / hours elapsed`
- `even pace = 100 / 168`
- `expected usage by now = hours elapsed / 168 × 100`
- `pace difference = actual used % - expected used %`
- `safe rate from now = remaining % / hours until reset`
- `rolling rate = change in observed weekly used % / elapsed hours across the selected rolling window`

The popup uses the exact reset timestamp and window duration returned by ChatGPT's usage service, so its calculations can be more precise than the rounded countdown displayed in Settings → Usage.

## Privacy / network behavior

The extension does not send usage data to any third party and has no analytics or telemetry.

For the live popup it makes authenticated requests only to `chatgpt.com`:

- `https://chatgpt.com/api/auth/session`
- `https://chatgpt.com/backend-api/wham/usage`
- fallback: `https://chatgpt.com/backend-api/codex/usage`

Where available, the usage request includes the active `ChatGPT-Account-Id` header so ChatGPT can route the request to the correct account/workspace. The session token is cached only in `chrome.storage.session` to reduce latency and naturally disappears with the browser session.

The normalized usage reading and graph history are cached locally in `chrome.storage.local` so the popup can render immediately while a live refresh is in progress.

## Compatibility note

The live usage endpoints are internal ChatGPT/Codex endpoints rather than a stable public API, so OpenAI may change them in the future. The extension also keeps the original Settings → Usage DOM parser as a separate on-page display.
