# Acquisition Pipeline Diagnostic Report: Naukri & Indeed

## Status Update: Naukri Calibration (August 22, 2026)

### 1. The Core Issue: Headless Bots vs "Warm" Sessions
Initial investigations discovered that attempting to acquire a Naukri Job Description URL directly (either via pure HTTP 'fetch' or via standard Playwright 'goto' on a fresh tab) results in a hard redirect to the generic jobs-in-india?expJD=true search page.

This behavior happens because Naukri's anti-bot telemetry requires a **"warm" session**. If a visitor lands directly on a JD URL without any referrer or session history indicating they came from a search page, Naukri classifies the visitor as a bot/scraper and issues a redirect.

### 2. The Supervised Experiment Proof
We successfully ran a supervised headful experiment that proved the following acquisition flow works seamlessly:
1. Initialize Playwright with stealth (puppeteer-extra-plugin-stealth).
2. Navigate to a standard Naukri search page (e.g., https://www.naukri.com/cxo-jobs?k=cxo). This "warms up" the session and establishes a valid user footprint.
3. Once the search results load, locate the first job link and instruct Playwright to navigate to that URL.
4. Because the session is now "warm," Naukri serves the full Job Description page instead of redirecting.

### 3. The Extraction Mechanism & The 'Read More' Truncation
Once on the page, the existing fallback mechanism (page.innerText("body")) pulls in massive amounts of noise (headers, footers, ad blocks). 

Our diagnostic proved that using targeted CSS selectors against the DOM successfully extracts the pure JD HTML.
The primary selector that succeeded on Naukri is:
\[class*='styles_job-desc-container']\

**Crucial Finding (The Truncation Bug):**
The HTML served initially by Naukri only contains the first half of the Job Description. The remaining text is hidden behind a "Read More" button, and is actually truncated in the DOM. 
To capture the full semantic JD, the scraper MUST locate and click the "Read More" button (or evaluate the full text from __NEXT_DATA__ if available) before attempting to pull the HTML content of the job-desc-container.

Our finalized automation verified that explicitly waiting for the DOM to render (.styles_job-desc-container) and clicking the 	ext=Read more locator correctly un-hides the remaining content, resulting in 100% semantic capture.

### 4. External Aggregation Risk & Dynamic Page Layouts
During manual supervision, we discovered that Naukri serves multiple completely different DOM structures depending on the specific job listing, primarily because it acts as an aggregator.

Some pages render the standard .styles_job-desc-container, while others use a vastly different layout without those class names (e.g., Job Description headings followed by un-classed <p> tags).

Furthermore, the aggregated summary on Naukri is often truncated, and the true, fully-formatted job description only exists on the company's external ATS page (linked via "Apply on Company Site").

If RADAR relies purely on rigid static selectors for Naukri, it will frequently fail to extract the description on aggregated variants, or extract a highly truncated summary that causes the scorer to fail an opportunity.

### Next Steps for Implementation
1. **Modify the Naukri Portal Scraper**: Update the Playwright scraping logic in the main RADAR application to always land on a Naukri search page first, establish cookies/session, and then navigate to the target JD URLs.
2. **Implement 'Read More' Click**: Before extraction, the scraper must wait for and click the "Read More" / "View More" button to expand the full JD into the DOM.
3. **Broaden HTML Extraction**: 
   - We must expand the primaryContainers list to account for the alternative DOM structures (e.g., .job-description, #job-description, or looking for the <h2>Job Description</h2> sibling).
   - Alternatively, fallback to page.evaluate() to pull the __NEXT_DATA__ JSON payload first, as the React state often holds the full un-truncated HTML regardless of which dynamic DOM structure is rendered.
4. **Follow ATS Links**: If a job contains an external apply link, RADAR must eventually trace that link and extract the JD from the target ATS rather than relying on the Naukri aggregation summary.
