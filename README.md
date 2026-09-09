# ChatGPT Weekly Usage Pace

A tiny Chromium/Brave extension that augments **ChatGPT → Settings → Usage**.

It reads the visible weekly-limit values from the page and adds:

- **Used %**
- **Average usage rate (% per hour)**
- **How far over/under an even weekly pace you are**
- **Safe rate from now until reset**
- **Projected usage at reset**

## Install in Brave

1. Clone or download this repository.
2. Open `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder (the folder containing `manifest.json`).
6. Open ChatGPT → **Settings → Usage**.

No external requests are made and no data is sent anywhere.

## Calculation

ChatGPT shows a weekly reset countdown, such as:

- `83% left`
- `Resets in 5d 14h`

The extension assumes the weekly period is exactly 7 days / 168 hours.

For that example:

- 17% has been used.
- 134 hours remain.
- About 34 hours have elapsed.
- Even pace at that point would be about 20.2% used.
- Therefore usage is about 3.2 percentage points **under pace**.
- Average usage so far is about 0.500% per hour.
- Safe average rate from now is about 0.619% per hour.

Because ChatGPT rounds the reset countdown shown in the UI, the pace numbers are approximate.

## Notes

The content script intentionally searches for visible labels like `Weekly limit`, `Resets in`, and `% left` instead of depending on ChatGPT's generated CSS class names. This should make it somewhat more resilient to UI updates.

If OpenAI changes the wording or structure of Settings → Usage, the selector/parser may need a small update.
