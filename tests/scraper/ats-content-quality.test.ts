import { describe, it, expect } from "vitest";
import { evaluateContentQuality, extractJobFromHtml } from "../../scripts/scraper/utils/http-fetch";

describe("ATS Content-Quality & Boilerplate Gate Contract", () => {
  it("classifies substantive executive job description as VALID", () => {
    const text = `
      Associate Vice President Brand Marketing Andamen Gurugram
      Company Description: Andamen is India's leading men's bridge-to-luxury DTC fashion brand.
      Role Description: We are seeking an Associate Vice President - Brand Marketing to architect our brand transformation.
      Key Responsibilities:
      - Define and continuously refine the brand's strategic positioning, purpose, and tone of voice.
      - Lead all brand marketing initiatives across D2C, marketplaces, and CRM driving awareness and performance.
      - Own the marketing AOP and budget, ensuring optimal allocation between brand and performance.
      - Build and inspire a high-performing brand marketing team.
      Key Qualifications:
      - 10-12 years of experience in brand marketing, ideally in fashion, lifestyle, or premium consumer brands.
      - Proven success in scaling online D2C brands.
    `;

    const quality = evaluateContentQuality(text, "Associate Vice President Brand Marketing", "Andamen");
    expect(quality.tier).toBe("VALID");
    expect(quality.confidence).toBeGreaterThanOrEqual(0.85);
    expect(quality.hasJobTitle).toBe(true);
    expect(quality.hasJobDescription).toBe(true);
  });

  it("classifies concise job specification as SPARSE (SPARSE is preserved, not failure)", () => {
    const text = `
      Deputy Director - Platforms & Solutions Pepsico Hyderabad
      Experience: 11-14 Yrs
      Salary: Not disclosed
      Key Skills: supply chain architecture, SAP solutions, enterprise logistics
      About the job: Responsible for leading global supply chain platforms, aligning enterprise application roadmaps, and managing vendor delivery.
    `;

    const quality = evaluateContentQuality(text, "Deputy Director", "Pepsico");
    // Short specification (under 60 words / 400 chars)
    expect(quality.tier).toBe("SPARSE");
    expect(quality.reasons.some(r => r.includes("SPARSE"))).toBe(true);
  });

  it("classifies generic portal redirect homepages (Ceipal pattern) as NON_JOB", () => {
    const redirectHtml = `
      <html>
        <body>
          <h1>We Want To Work With You</h1>
          <p>Job searching just got simpler. If you are a highly skilled professional seeking a career opportunity, search our open jobs database.</p>
          <div class="search-box">
            <input type="text" placeholder="Search jobs filters" />
            <button>Search</button>
          </div>
        </body>
      </html>
    `;

    const res = extractJobFromHtml(redirectHtml);
    expect(res.success).toBe(false);
    expect(res.outcome).toBe("EXTRACTION_FAILURE");
    expect(res.quality.tier).toBe("NON_JOB");
    expect(res.quality.boilerplateDetected?.length).toBeGreaterThan(0);
  });

  it("classifies script/executable code dominance as NON_JOB", () => {
    const scriptDominatedText = `
      var queuedSuperProps = []; var queuedEvents = []; window.ub = { track: function (eventName, eventProps) { queuedEvents.push([eventName, eventProps]); } };
      (function() { var s = document.createElement('script'); s.src = 'https://cdn.tracking.com/lib.js'; })();
    `;

    const quality = evaluateContentQuality(scriptDominatedText);
    expect(quality.tier).toBe("NON_JOB");
    expect(quality.codeRatio).toBeGreaterThan(0.10);
  });
});
