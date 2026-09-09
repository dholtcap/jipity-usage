# ChatGPT Weekly Usage Pace

A small Chromium/Brave extension for tracking the weekly ChatGPT/Codex usage limit and whether your current pace will make it to the reset.

It works in two places:

- **ChatGPT → Settings → Usage** — adds the pace calculations under the existing weekly-limit card.
- **Browser toolbar popup** — click the extension from any site to see the same information with a fresh live usage check.

## Metrics

The extension shows:

- **Used %** and **remaining %**
- **Average usage rate (% per hour)**
- **How far over/under an even weekly pace you are**
- **Safe rate from now until reset**
- **Projected usage at reset**
- **Reset countdown** and exact local reset time

## Install in Brave

1. Clone or download this repository.
2. Open `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder (the folder containing `manifest.json`).
6. Make sure you are signed in to `chatgpt.com`.

To update an already-loaded development copy after pulling new files, return to `brave://extensions` and click **Reload** on the extension card.

## Live popup

Version 0.2 adds a browser-action popup. When you click the extension icon it:

1. Shows the most recently cached usage immediately, if available.
2. Requests a fresh ChatGPT session token from the signed-in browser session.
3. Fetches the current usage response from ChatGPT.
4. Recalculates pace using the exact weekly reset timestamp.
5. Refreshes every 30 seconds while the popup is open. A background refresh also runs once per minute.

This means the popup works even when your active tab is not on ChatGPT.

## Calculation

For a 7-day / 168-hour weekly window:

- `used % = 100 - remaining %`
- `average rate = used % / hours elapsed`
- `even pace = 100 / 168`
- `expected usage by now = hours elapsed / 168 × 100`
- `pace difference = actual used % - expected used %`
- `safe rate from now = remaining % / hours until reset`

The popup uses the exact reset timestamp returned by ChatGPT's usage service, so its calculations can be more precise than the rounded countdown displayed in Settings → Usage.

## Privacy / network behavior

The extension does not send usage data to any third party and has no analytics or telemetry.

For the live popup it makes authenticated requests only to `chatgpt.com`:

- `https://chatgpt.com/api/auth/session`
- `https://chatgpt.com/backend-api/wham/usage`
- fallback: `https://chatgpt.com/backend-api/codex/usage`

The usage response is cached locally in `chrome.storage.local` so the popup can render instantly while a refresh is in progress. The access token itself is not stored by the extension.

## Compatibility note

The live usage endpoints are internal ChatGPT/Codex endpoints rather than a stable public API, so OpenAI may change them in the future. The extension also keeps the original Settings → Usage DOM parser as a separate on-page display.
