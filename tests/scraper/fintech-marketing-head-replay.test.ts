import { describe, it, expect } from "vitest";
import { extractJobFromHtml } from "../../scripts/scraper/utils/http-fetch";
import { extract } from "../../scripts/scraper/extract/extractor";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { CapabilityAssessmentEngine } from "../../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import { candidateProfile } from "../../src/data/candidate-profile";
import { CanonicalEvaluator } from "../../src/lib/intelligence/evaluation/CanonicalEvaluator";
import type { DetailedCard } from "../../scripts/scraper/types";

describe("The FinTech Marketing Head Acceptance Replay Test", () => {
  const dummyCandidate = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);

  // Exact failure shape from run-1788182498220:
  // IIMJobs page with tracking JavaScript at the top and rich executive job description in body
  const rawIimJobsHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Head - Marketing - FinTech (10-15 yrs) - Live Connections</title>
        <script>
          var queuedSuperProps = [];
          var queuedEvents = [];
          window.ub = {
            track: function (eventName, eventProps) {
              queuedEvents.push([eventName, eventProps]);
            }
          };
          window.ub.track("page_loaded", { site: "iimjobs", category: "fintech" });
        </script>
      </head>
      <body>
        <script>
          (function() {
            var tracker = document.createElement('script');
            tracker.src = 'https://analytics.iimjobs.com/tracker.js';
          })();
        </script>
        <div class="header-nav">
          <nav>
            <a href="/">Home</a> | <a href="/jobs">Jobs</a> | <a href="/post">Post Job</a>
          </nav>
        </div>
        <main class="main-wrapper">
          <div class="job-container">
            <h1 class="title">Head - Marketing - FinTech (10-15 yrs)</h1>
            <div class="company">Live Connections</div>
            <div class="location">Chennai, Gurugram (Hybrid)</div>
            
            <div class="job-desc" id="job-description">
              <h3>Role Summary</h3>
              <p>
                Our client is a top-tier, fast-growing FinTech company providing digital payments, lending, and neo-banking solutions.
                We are looking for an exceptional Head of Marketing to direct our integrated commercial strategy, brand building, performance marketing, and corporate communications.
              </p>

              <h3>Key Mandates & Responsibilities</h3>
              <ul>
                <li>Own and allocate the commercial marketing budget (AOP) of ₹40 Crore across digital, growth, branding, and event channels.</li>
                <li>Lead customer acquisition (CAC/LTV optimization), organic growth, search visibility (SEO/SEM), and retention across B2B and B2C channels.</li>
                <li>Drive brand positioning and digital transformation, establishing the company as the premier FinTech platform in India.</li>
                <li>Manage and mentor a high-performing marketing organization of 20+ managers across performance marketing, PR, and lifecycle marketing.</li>
                <li>Partner directly with the Chief Executive Officer and Product leadership on go-to-market strategies for new FinTech product launches.</li>
              </ul>

              <h3>Candidate Profile</h3>
              <ul>
                <li>10 to 15 years of substantive marketing leadership experience in FinTech, BFSI, or consumer internet.</li>
                <li>Proven track record in scaling digital customer acquisition and managing large-scale performance marketing budgets.</li>
                <li>Strong executive presence, data-driven analytical acumen, and deep commercial instincts.</li>
              </ul>
            </div>
          </div>
        </main>
        <footer class="site-footer">
          <p>© 2026 iimjobs.com. All rights reserved.</p>
        </footer>
      </body>
    </html>
  `;

  it("successfully extracts pristine job content without script pollution", () => {
    const extracted = extractJobFromHtml(
      rawIimJobsHtml,
      undefined,
      undefined,
      "Head - Marketing - FinTech (10-15 yrs)",
      "Live Connections"
    );

    expect(extracted.success).toBe(true);
    expect(extracted.outcome).toBe("SUCCESS");
    expect(extracted.quality.tier).toBe("VALID");

    // Zero tracking scripts or executable code remnants
    expect(extracted.rawText).not.toContain("window.ub");
    expect(extracted.rawText).not.toContain("queuedSuperProps");
    expect(extracted.rawText).not.toContain("function");
    expect(extracted.rawText).not.toContain("<script");

    // Recovers title, company, and core mandate
    expect(extracted.rawText).toContain("Head of Marketing");
    expect(extracted.rawText).toContain("FinTech");
    expect(extracted.rawText).toContain("CAC/LTV optimization");
    expect(extracted.rawText).toContain("₹40 Crore");
  });

  it("progresses cleanly from sanitized ATS extraction to deterministic policy evaluation WITHOUT G-EVIDENCE-INTEGRITY-FAILED", async () => {
    // 1. Stage 1: Sanitized ATS extraction
    const extracted = extractJobFromHtml(
      rawIimJobsHtml,
      undefined,
      undefined,
      "Head - Marketing - FinTech (10-15 yrs)",
      "Live Connections"
    );

    // 2. Stage 2: Create DetailedCard
    const detailedCard: DetailedCard = {
      cardHash: "iimjobs_fintech_cmo_card",
      title: "Head - Marketing - FinTech (10-15 yrs)",
      company: "Live Connections",
      location: "Chennai, Gurugram (Hybrid)",
      portal: "Naukri",
      detailUrl: "https://www.iimjobs.com/j/head-marketing-fintech-1728660",
      rawText: "Head - Marketing - FinTech (10-15 yrs) Live Connections",
      snapshotSchemaVersion: "1.0.0",
      scraperVersion: "1.0.0",
      acquisitionRoute: "ATS_ENRICHED",
      enrichmentStatus: "ENRICHED_SUCCESS",
      detail: {
        fetched: true,
        rawHtml: extracted.rawHtml,
        rawText: extracted.rawText,
        fetchDurationMs: 120,
        httpStatus: 200
      },
      telemetry: { cardExtractMs: 0, detailExtractMs: 120, totalMs: 120 }
    };

    // 3. Stage 3: Extraction layer produces structured dimension evidence
    const extractionResult = await extract(detailedCard, { mode: "deterministic" });
    expect(extractionResult.dimensions.length).toBeGreaterThan(0);

    // 4. Stage 4: Run end-to-end evaluation via CanonicalEvaluator
    const oppObj = {
      jobHash: detailedCard.cardHash,
      role: detailedCard.title,
      company: detailedCard.company,
      location: detailedCard.location,
      rawText: detailedCard.detail.rawText,
      dimensions: extractionResult.dimensions
    };

    const evalOutput = CanonicalEvaluator.evaluateOpportunity(oppObj as any, dummyCandidate);
    expect(evalOutput).toBeDefined();
    expect(evalOutput.record).toBeDefined();

    // CRITICAL ACCEPTANCE INVARIANTS:
    // 1. Not vetoed by G-EVIDENCE-INTEGRITY-FAILED
    const ruleIds = (evalOutput.record as any).triggeredRuleIds || [];
    expect(ruleIds).not.toContain("G-EVIDENCE-INTEGRITY-FAILED");
    expect(ruleIds).not.toContain("G-EVIDENCE-GATE-SPARSE-SPEC");

    // 2. Evaluates cleanly to an executive recommendation (CONSIDER or PURSUE)
    expect(["CONSIDER", "PURSUE"]).toContain(evalOutput.record.verb);
    expect(evalOutput.record.qualityScore).toBeGreaterThanOrEqual(50);
  });
});
