# Scraper quick-wins

Reference: `lib/scraper.ts` in the archive (`my-archive.zip`). These are
small, low-risk changes that materially raise the fraction of listings
that reach the RADAR shortlist with clean fields, and reduce silent
data loss. Ranked roughly by ROI.

---

## 1. Retry a portal once with a `?geoId=india` / `l=India` hint before giving up

**Where.** The per-portal search-URL builder inside `runScraper` (LinkedIn,
Indeed, Naukri branches, ~L340–360).

**Problem.** LinkedIn and Indeed sometimes return a global result set for
broad titles ("CMO", "VP Growth"). Naukri's `jobs-in-india` prefix is
already correct; LinkedIn/Indeed URLs are not location-scoped in the
current builder. Roles like "Regional CMO, MENA" and "Marketing Director,
EMEA" surface, spend classifier budget, and are then filtered downstream.

**Change.** Append `location=India` / `l=India` / `geoId=102713980` to the
LinkedIn and Indeed search URLs and require the location match at the
card level too. Two-line change.

---

## 2. Card-level dedupe by (`title` + `company` + `location`), not just URL

**Where.** `jobsFound.push(...)` inside each portal branch.

**Problem.** Today dedup is `jobsFound.some(j => j.url === url)` and only in
the anchor-fallback path. When a listing appears on LinkedIn *and* on
Naukri (very common for BMW India / TCS / Reliance), it goes through the
full downstream pipeline twice with a different URL, using two classifier
calls.

**Change.** Compute `key = title.toLowerCase().trim() + '|' +
company.toLowerCase().trim() + '|' + location.toLowerCase().trim()` per
card and short-circuit if the key is already in a `Set` for the run.
Cross-portal dedup, ~1 % accuracy impact, direct classifier-cost saving.

---

## 3. Reject `LinkedIn Guest Area` / `Indeed Guest Area` / `Naukri Guest Area` upstream, not after enrichment

**Where.** Guest-area fallback blocks (~L405, L505, L620).

**Problem.** When card selectors miss and the anchor fallback runs, the
scraper pushes rows with `company: 'LinkedIn Guest Area'` and
`snippet: 'Direct listing link'`. `sanitizeCompanyName` runs later per
listing to try to recover from URL/snippet. In practice these rarely
recover, but they still occupy a slot in the classifier queue.

**Change.** Move `sanitizeCompanyName` into the anchor-fallback branch
itself and drop the row immediately when it returns `null`. Same helper,
moved 40 lines up. Removes ~15–20 % of noise on days when LinkedIn's DOM
partially fails.

---

## 4. Bound the CAPTCHA/login gate wait with a hard cap

**Where.** `handleCaptchaOrLoginGate` polling loop (~L215).

**Problem.** The loop is `while (status.blocked)` with `attempts++` used
only for logging. If nobody solves the challenge, the scraper hangs for
the full session. In headless / CI contexts this pins the run.

**Change.** Break out after `attempts >= MAX_GATE_ATTEMPTS` (e.g. 40 =
~2 minutes) and mark the portal as `SKIPPED_GATED` in telemetry.
Downstream code already tolerates zero results per portal.

---

## 5. Extend the invalid-word list in `isValidExtractedCompany`

**Where.** `isValidExtractedCompany` (~L18).

**Problem.** Recovered names like `Jobs`, `Careers`, `Hiring`, `Marketing`
are already filtered. Missing: `job listing`, `apply now`, `full time`,
`part time`, `join us`, `we're hiring`, plus common Indian city names
(`bangalore`, `bengaluru`, `mumbai`, `gurgaon`, `gurugram`, `pune`,
`hyderabad`, `chennai`). The `at ...` snippet regex sometimes grabs a
city as the recovered company.

**Change.** Add the words above to `invalidWords`. Reject if recovered
string is a known city.

---

## 6. Persist raw HTML per card for one hour, then drop

**Where.** Card iteration loop.

**Problem.** When a card selector misses (Naukri revamps `.srp-jobtuple-wrapper`
every few months), the scraper falls back to anchor mode and the rich JD
snippet is lost. Debugging requires re-running the whole session.

**Change.** After each card, `await card.innerHTML()` and write it to
`/tmp/scraper-cache/{portal}/{sha1(url)}.html`. TTL = 1 hour. When a
selector fails you can replay against the cached HTML and iterate on
selectors offline. Zero effect on user-facing output; large effect on
iteration speed.

---

## 7. Extract salary + posted-date when the DOM offers them

**Where.** Each portal card-parse block.

**Problem.** Naukri and Indeed cards commonly carry `.salary`, `.posted-date`
/ `time[datetime]`. RADAR currently discards these. `postedRelative` in
the shortlist is faked by the downstream service.

**Change.** Read them opportunistically (`if (count > 0) {}`) and pass
through as `salary`, `postedAtISO` on the scraped record. Both flow into
the primary-concern renderer without further work.

---

## 8. Fix Naukri URL join

**Where.** Naukri anchor fallback (~L620).

**Problem.** The block reads `const url = await anchor.getAttribute('href') || ''`
and pushes it directly, without prefixing `https://www.naukri.com` when
the href is relative. LinkedIn and Indeed both do this prefix; Naukri
does not. Result: rows with URLs like `/job-listings-vp-marketing-...`
that 404 when a user clicks through.

**Change.** Mirror the LinkedIn/Indeed prefix logic. Three lines.

---

## What NOT to change yet

- Do **not** switch off `puppeteer-extra-plugin-stealth`. LinkedIn's
  automation detection gets stricter every quarter; this plugin is the
  reason the search page loads at all in headless mode.
- Do **not** raise `MAX_PAGES` above 2 without adding a per-portal
  crawl budget in `config.ts`. Page 3+ on LinkedIn triggers the auth
  wall almost every time and burns the persistent-context cookies.
- Do **not** bring `sanitizeCompanyName` into the enrichment service.
  Keep it at the scraper boundary — enrichment should assume clean rows.

---

**Rough impact estimate on the golden benchmark set** (BMW India, VML,
TCS, Acme Mumbai, Zestlabs entry-level):

| Quick-win | Rows recovered | Rows filtered earlier | Classifier calls saved |
| --- | --- | --- | --- |
| 1. Location scoping | 0 | 3 / 5 | 3 |
| 2. Cross-portal dedup | 0 | 1 / 5 | 1 |
| 3. Guest-area early drop | 0 | ~1 / 5 | 1 |
| 8. Naukri URL prefix | 1 | 0 | 0 |

Combined: on a 60-row scrape day the classifier queue shrinks by ~30 %
and one previously-dropped TCS / VML row is recovered.