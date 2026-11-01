- [x] Add inspirations for different milestones
- [ ] Filter by Recency
      
# Minimalist Birthday & Milestone Countdown

This Manifest V3 extension replaces New Tab with a minimalist countdown
dashboard. Birthday data, settings, and milestones remain under `countdownData`
in `chrome.storage.local`; research state is stored separately under
`countdownResearch`. The Google homepage content script reads only
`countdownData` and remains a separate, conservative integration.

## Inspiration requires your Exa key

Inspiration is inactive until you add your own Exa API key in the popup:

1. Open the extension toolbar popup.
2. In **Inspiration (requires an Exa API key)**, enter the key.
3. Save it, then optionally use **Test key**.

The key is stored locally in this browser and is used only by the extension
service worker. It is not hidden from the user. Countdown calculations work
with no key. Invalid keys, exhausted credits, rate limits, and network
failures are reported without affecting countdowns.

Get a key at [exa.ai](https://exa.ai); new accounts include free credits.
Inspiration sends only a generic search phrase, such as `19 year old
accolades` when the user is turning 20, to Exa. Age inspiration uses only the
age immediately before the target age, not the target age itself. It does not
send the birth date, user's name, or full
milestone text.

## Research pipeline

The highest-priority eligible birthday or milestone is interpreted
deterministically:

1. Interpret it as an age target or a cleaned topic.
2. Select a rotating achievement-oriented query template.
3. Search the general web with Exa.
4. Verify structured facts, the age immediately before the target age, topic
   relevance, URL, and
   duplicate people.
5. Display the sourced achievement.

The service worker calls `POST https://api.exa.ai/search` with `x-api-key`,
`type: "auto"`, and at most 15 results per call. Exa's documented public
maximum is 100 results. The request asks for highlights and a structured
`contents.summary.schema`; this is the documented Exa field for structured
summary extraction, rather than a separate per-result AI service. A fetch
uses one call normally and at most two calls when fewer than eight validated
items are found.

Cards show exactly four items per page when available: two in the left column
and two in the right. Pagination uses the cached pool and makes no Exa calls.
The final page drops an odd extra item so the columns remain balanced. Refresh
bypasses the automatic cache, rotates unused templates and keywords, excludes
seen URLs and people, and resets the seen lists when the available pool is
exhausted.

Automatic loads reuse a 24-hour cache keyed by milestone signature. The cache
stores the pool, current page, seen URLs, seen people, template keys, fetch
time, attempt status, and research version. Empty and error attempts are
throttled for 30 minutes, while stale pools are shown immediately and refreshed
in the background. Refresh failures retain the previous pool.

## Images and attribution

Images resolve lazily for visible cards:

1. A matching English Wikipedia portrait using a Wikimedia-hosted thumbnail.
2. The Exa result's HTTPS image, credited to its source domain.
3. A plain black-and-white monogram when no image is available.

Images use fixed dimensions and are removed on load failure without removing
the card. Every card links to the HTTPS Exa result page, displays its domain
and publication date when available, and shows the evidence sentence supplied
by Exa. No stock images are used.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Configure countdowns and the Exa key from the toolbar popup.
5. Reload the extension after changing files and open a fresh New Tab.

Dates and optional times use the computer's local timezone. Date-only
milestones use local midnight. February 29 birthdays are observed on February
28 during non-leap years. Countdown values update every second.
