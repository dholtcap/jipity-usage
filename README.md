# Jipity Usage

A small Chromium/Brave extension for tracking the weekly ChatGPT/Codex usage limit and whether your current pace will make it to the reset.

It works in two places:

- **ChatGPT → Settings → Usage** — adds pace calculations under the existing weekly-limit card.
- **Browser toolbar popup** — click the extension from any site to see live usage, pace, projection, and a weekly trajectory chart.

## v0.3 visual dashboard

Version 0.3 adds:

- Semantic status colors:
  - **Green** — projected usage is comfortably below the weekly limit.
  - **Amber** — projected usage is close to 100% at reset.
  - **Red** — current average pace would hit the limit before reset.
- A target marker on the usage bar showing how much of the week has elapsed / where even usage would be by now.
- A weekly trajectory chart showing:
  - **Usage** — locally observed usage over the current weekly window.
  - **Even pace** — a straight 0% → 100% line through the week.
  - **Projection** — where the current average usage rate leads by reset.
- Local usage-history snapshots so the graph becomes more detailed as the extension runs.
- A clearer **Live / Cached** state in the footer.
- A fix for the loading/error cards incorrectly remaining visible after data had loaded.
- More reliable WHAM requests by including the active `ChatGPT-Account-Id` header when it can be resolved from the signed-in ChatGPT session.

## Metrics

The extension shows:

- **Used %** and **remaining %**
- **Average usage rate (% per hour)**
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
2. Requests the current ChatGPT session from the signed-in browser session.
3. Resolves the active ChatGPT account/workspace ID when available.
4. Fetches the current usage response from ChatGPT.
5. Recalculates pace using the exact weekly reset timestamp.
6. Records a small local history sample for the trajectory graph.
7. Refreshes every 30 seconds while the popup is open. A background refresh also runs once per minute.

This means the popup works even when your active tab is not on ChatGPT.

History samples are stored only in `chrome.storage.local`. Samples are retained only for the active weekly window and are coalesced to avoid unnecessary storage growth.

## Calculation

For a 7-day / 168-hour weekly window:

- `used % = 100 - remaining %`
- `average rate = used % / hours elapsed`
- `even pace = 100 / 168`
- `expected usage by now = hours elapsed / 168 × 100`
- `pace difference = actual used % - expected used %`
- `safe rate from now = remaining % / hours until reset`

The popup uses the exact reset timestamp and window duration returned by ChatGPT's usage service, so its calculations can be more precise than the rounded countdown displayed in Settings → Usage.

The graph cannot reconstruct usage changes that happened before v0.3 began recording local snapshots. Until enough snapshots accumulate, the first segment from the weekly reset to the first observed point represents the average usage path over that period.

## Privacy / network behavior

The extension does not send usage data to any third party and has no analytics or telemetry.

For the live popup it makes authenticated requests only to `chatgpt.com`:

- `https://chatgpt.com/api/auth/session`
- `https://chatgpt.com/backend-api/wham/usage`
- fallback: `https://chatgpt.com/backend-api/codex/usage`

Where available, the WHAM request includes the active `ChatGPT-Account-Id` header so ChatGPT can route the request to the correct account/workspace. The access token itself is never stored by the extension.

The normalized usage reading and graph history are cached locally in `chrome.storage.local` so the popup can render instantly while a refresh is in progress.

## Compatibility note

The live usage endpoints are internal ChatGPT/Codex endpoints rather than a stable public API, so OpenAI may change them in the future. The extension also keeps the original Settings → Usage DOM parser as a separate on-page display.
