# Minimalist Birthday & Milestone Countdown

This is a Manifest V3 Chrome extension with independent displays and a toolbar
popup that share `chrome.storage.local` under the `countdownData` key:

- `newtab.html` replaces Chrome's New Tab page. It displays countdowns and
  asynchronously cached milestone inspiration; management is intentionally in
  the toolbar popup.
- `popup.html` provides birthday settings, enable/disable, milestone add/edit/
  delete/reorder, and inspiration settings. Birthday is stored as the special
  `birthday` item in the same persisted `order` array as ordinary milestones.
  The first eligible item in that order is the highest-priority research
  context.
- `google-homepage.js` is a narrowly scoped, read-only display for the exact
  Google homepage paths `https://www.google.com/` and `https://www.google.ca/`.
  It does not run on `/search` or other sites. It waits for Google's logo and
  fails quietly if the page structure does not expose a compatible logo.

Milestone inspiration uses public English Wikipedia MediaWiki results plus
public GDELT article discovery through the extension service worker. It uses
expanded concept-based fallback queries for employment, education, relocation,
business, language learning, travel, sport, and age milestones. Results are
filtered, deduplicated, URL-validated, and cached for 24 hours. GDELT results
provide discovery metadata and links; the extension does not scrape or claim
to have read publishers' full articles.

Where supported, `local-ai.js` uses Chrome's current `LanguageModel` Prompt API
on-device to interpret milestone intent, generate diverse queries, rank
retrieved metadata, and shorten source-provided summaries. It never sends
milestone or article data to an AI service. The popup's **Set up on-device AI**
button is the user-initiated model setup path; if the API or model is
unavailable, the conventional research engine remains active.

Prompt API support depends on Chrome's current release and device eligibility.
Chrome's documented foundation-model requirements include supported desktop
operating systems, roughly 22 GB free profile storage, and either more than
4 GB GPU VRAM or at least 16 GB RAM with 4 CPU cores. Chrome downloads the
Gemini Nano model separately. Check `chrome://on-device-internals` for model
status. These requirements can change; the fallback does not require them.

Dates and optional times use the computer's local timezone. A date-only
milestone is treated as midnight local time. February 29 birthdays are
observed on February 28 in non-leap years. Countdown values are recalculated
from the current time every second, so sleep and inactive tabs do not cause
drift.

## Load locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project folder.
4. Open a new tab, then use the extension toolbar icon to enter a birthday and
   add/reorder milestones.
5. Refresh or close and reopen Chrome to verify persistence, ordering, and the
   cached inspiration.
6. Visit `https://www.google.com/` or `https://www.google.ca/` to verify the
   shared read-only dashboard above Google's existing logo and search box.

## Troubleshooting

- After changing extension files, return to `chrome://extensions` and click
  **Reload**, then open a fresh tab.
- If saved data is not visible, confirm the extension is enabled and inspect
  its service/storage errors in the extension's details page.
- If Google changes its homepage markup, the content script intentionally
  leaves the page unchanged rather than disrupting search. The New Tab
  dashboard remains independent and continues to work.
- Research requires network access to public research APIs. Rate limits or
  outages are handled without affecting countdowns; previously cached results
  are retained.
- The research source is intentionally conservative: it does not scrape
  arbitrary publications or claim that a person completed a user's goal.
  Wikipedia's coverage of ordinary employment and graduation stories is
  limited, so the fallback may return fewer results for those topics.
