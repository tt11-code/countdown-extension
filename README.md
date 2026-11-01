# Minimalist Birthday & Milestone Countdown

This Manifest V3 extension replaces New Tab with a black-on-white countdown
dashboard and keeps the same data in `chrome.storage.local` under
`countdownData`. The popup manages the birthday, milestone order, and
inspiration setting. `google-homepage.js` provides the separate, conservative
Google homepage integration.

## AI-only inspiration

Inspiration requires Chrome's on-device Prompt API (`LanguageModel`) and
Gemini Nano. If the browser/device reports `unavailable`, no research request
is made. If the model is `downloadable` or `downloading`, use **Set up
on-device AI** in the popup. No milestone or article data is sent to an
external AI service, and there is no conventional or rule-based fallback.

The pipeline is:

1. Interpret the highest-priority eligible birthday or milestone.
2. Generate 8–10 achievement-oriented search queries on-device.
3. Retrieve English Wikipedia metadata through the service worker.
4. Verify age evidence where applicable.
5. Rank candidates on-device.
6. Generate display titles and summaries on-device only for the visible page.

The model is constrained to supplied source text. Generated numbers are
validated against that text; unsupported generated wording is replaced with
the source title and first sentence. Every card links to
`Source: Wikipedia – <article title>` and uses only HTTPS Wikimedia images.

## Pagination, caching, and refresh

The research pool is larger than one page and is split evenly between the two
desktop side columns. The page size is computed from viewport height and a
fixed card image/summary layout, so desktop inspiration does not create a
scrollbar. Narrow layouts retain even-number pagination and collapse to the
existing responsive grid. Resize recomputes the page size.

Automatic loads use a 24-hour cache keyed by the milestone signature. The
cache stores the pool, page, queries, and up to 300 URLs already shown.
Pagination is in-memory and page-specific AI presentation is lazy. Refresh
always bypasses the time cache, asks for different query angles, excludes
seen URLs, retries once, and starts over with a status message if the
available unseen pool is exhausted.

## Requirements and local loading

Use a current Chrome release with Prompt API support and a compatible desktop
device. Chrome's on-device model may require substantial free storage and
hardware resources; check `chrome://on-device-internals` for model status.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Configure the birthday and milestones from the toolbar popup.
5. Reload the extension after changing files and open a fresh New Tab.

Dates and optional times use the computer's local timezone. Date-only
milestones use local midnight. February 29 birthdays are observed on February
28 during non-leap years. Countdown calculations update every second.

## Troubleshooting

Network failures, rate limits, unavailable models, and model errors leave the
countdowns usable and retain the previous research pool. If Google's DOM
changes, the content script intentionally does not alter the page unless it
can identify the existing logo and search field safely.
