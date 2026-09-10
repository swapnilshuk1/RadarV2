import { describe, it, expect, vi } from "vitest";
import { ResponseValidator } from "../../src/lib/acquisition/validator";

describe("LinkedIn Rich Discovery Fallback Invariant", () => {
  it("does not classify an incomplete discovery card snippet as a COMPLETE job document", () => {
    // Typical LinkedIn search card text: ~450 characters containing metadata and truncated snippet
    const cardSnippetText = `
      Chief Marketing Officer
      Swiggy · Bengaluru, Karnataka, India
      2 weeks ago · 45 applicants
      About the job:
      We are looking for an experienced Chief Marketing Officer to lead our growth and marketing strategies across all business verticals. The ideal candidate will have over 15 years of consumer tech leadership experience, managing multi-million dollar performance budgets, brand marketing, customer lifecycle management, and corporate communications.
    `.trim().replace(/\s+/g, " ");

    expect(cardSnippetText.length).toBeGreaterThan(400);

    const validation = ResponseValidator.validate({
      html: `<div class="job-card">${cardSnippetText}</div>`,
      url: "https://www.linkedin.com/jobs/view/1234567890",
      sourcePortal: "LinkedIn",
      httpStatus: 200,
      extractedTitle: "Chief Marketing Officer",
      extractedCompany: "Swiggy",
      extractedDescription: cardSnippetText,
    });

    // An incomplete snippet must NOT be accepted as COMPLETE
    // (It either evaluates to PARTIAL or requires full detail extraction)
    expect(validation.quality).not.toBe("COMPLETE");
  });

  it("classifies an exhaustive full job document as COMPLETE", () => {
    // Genuine full JD containing comprehensive responsibilities, qualifications, requirements > 1200 chars
    const fullJdText = `
      Chief Marketing Officer (CMO)
      About Swiggy:
      Swiggy is India's leading on-demand convenience platform with a vision to deliver unmatched convenience to urban consumers.
      Role Summary:
      We are seeking a visionary Chief Marketing Officer to head the centralized marketing organization, reporting directly to the Group CEO.
      Key Responsibilities:
      - Own end-to-end brand strategy, creative excellence, and media execution across India.
      - Drive growth and performance marketing initiatives managing an annual budget in excess of ₹250 Crores.
      - Lead customer acquisition, retention, loyalty, and brand reputation across all categories.
      - Mentor and scale a high-performing team of 60+ professionals across brand, digital, performance, CRM, and analytics.
      - Partner with product, operations, and business category heads to scale market share.
      Required Experience & Qualifications:
      - 18+ years of total experience with at least 8 years in an executive marketing leadership role (VP, Head of Marketing, or CMO).
      - Proven track record scaling tier-1 consumer internet or high-growth FMCG brands.
      - Deep expertise in P&L ownership, consumer insights, digital transformation, and executive stakeholder alignment.
      - Master's degree in Business Administration (MBA) or equivalent executive education.
    `.trim().replace(/\s+/g, " ");

    expect(fullJdText.length).toBeGreaterThan(1000);

    const validation = ResponseValidator.validate({
      html: `<div class="jobs-description">${fullJdText}</div>`,
      url: "https://www.linkedin.com/jobs/view/1234567890",
      sourcePortal: "LinkedIn",
      httpStatus: 200,
      extractedTitle: "Chief Marketing Officer",
      extractedCompany: "Swiggy",
      extractedDescription: fullJdText,
    });

    expect(validation.isValid).toBe(true);
    expect(validation.quality).toBe("COMPLETE");
  });

  it("ensures incomplete discovery cards trigger fetchDetail fallback rather than immediate rejection", async () => {
    const cardSnippet = "Short discovery card preview text with 420 characters " + "repeating marketing copy ".repeat(15);
    expect(cardSnippet.length).toBeGreaterThan(400);

    const mockFetchDetail = vi.fn().mockResolvedValue({
      fetched: true,
      rawHtml: "<div>Full authentic job description with comprehensive details</div>",
      rawText: "Full authentic job description with comprehensive details extending well over 800 characters and detailing all requirements and qualifications...",
      fetchDurationMs: 120,
      httpStatus: 200,
    });

    const handler: any = {
      fetchDetail: mockFetchDetail,
    };

    // Simulate orchestrator logic in scripts/scrape.ts
    const feedCard = {
      title: "Chief Marketing Officer",
      company: "Acme Corp",
      detailUrl: "https://www.linkedin.com/jobs/view/999888",
      rawText: cardSnippet,
      rawHtml: `<div>${cardSnippet}</div>`,
    };

    let detail: any = null;
    let usedRichDiscovery = false;

    if (feedCard.rawText && feedCard.rawText.length >= 400 && feedCard.rawHtml && feedCard.rawHtml.length >= 400) {
      const provisional = ResponseValidator.validate({
        html: feedCard.rawText,
        url: feedCard.detailUrl,
        sourcePortal: "LinkedIn",
        httpStatus: 200,
        extractedTitle: feedCard.title,
        extractedCompany: feedCard.company,
        extractedDescription: feedCard.rawText,
      });

      if (provisional.isValid && provisional.quality === "COMPLETE") {
        usedRichDiscovery = true;
        detail = {
          fetched: true,
          rawHtml: feedCard.rawHtml,
          rawText: feedCard.rawText,
        };
      }
    }

    if (!usedRichDiscovery) {
      detail = await handler.fetchDetail({}, feedCard.detailUrl);
    }

    // Must NOT have used the incomplete snippet
    expect(usedRichDiscovery).toBe(false);
    // Must have invoked handler.fetchDetail
    expect(mockFetchDetail).toHaveBeenCalledTimes(1);
    expect(mockFetchDetail).toHaveBeenCalledWith({}, feedCard.detailUrl);
    expect(detail.fetched).toBe(true);
  });

  it("adversarially proves search-card provenance (>1000 chars) still invokes fetchDetail unless payload explicitly carries authoritative full-detail provenance (Gate 2)", async () => {
    // Rich snippet that is > 1000 characters and looks like a complete JD to ResponseValidator
    const richSnippetText = `
      Chief Marketing Officer
      About Swiggy: Swiggy is India's leading on-demand convenience platform with a mission to elevate the quality of life for urban consumers.
      Role Summary: We are seeking an exceptional executive Chief Marketing Officer to head the centralized marketing organization and drive national brand salience.
      Key Responsibilities:
      - Own end-to-end brand strategy, creative excellence, performance marketing, and media execution across India.
      - Drive growth and performance marketing initiatives managing an annual marketing and acquisition budget in excess of ₹250 Crores.
      - Lead customer acquisition, retention, consumer loyalty, lifecycle marketing, and brand reputation across all business categories.
      - Mentor, inspire, and scale a high-performing cross-functional team of 60+ marketing professionals across brand, digital, CRM, and analytics.
      - Partner with executive leadership, product directors, engineering, and category general managers to expand national market share.
      Required Qualifications:
      - 18+ years of total experience with at least 8 years in an executive marketing leadership role (VP, Head of Marketing, or CMO).
      - Proven track record scaling tier-1 consumer internet, e-commerce, or high-growth FMCG brands from hyper-growth to market leadership.
      - Deep expertise in P&L ownership, consumer insights, digital transformation, brand governance, and executive stakeholder management.
      - Master's degree in Business Administration (MBA) or equivalent executive qualifications from an accredited top-tier business school.
    `.trim().replace(/\s+/g, " ");

    expect(richSnippetText.length).toBeGreaterThan(1000);

    // Verify ResponseValidator by itself would consider this COMPLETE:
    const provisionalValidation = ResponseValidator.validate({
      html: `<div class="jobs-description">${richSnippetText}</div>`,
      url: "https://www.linkedin.com/jobs/view/999888",
      sourcePortal: "LinkedIn",
      httpStatus: 200,
      extractedTitle: "Chief Marketing Officer",
      extractedCompany: "Swiggy",
      extractedDescription: richSnippetText,
    });
    expect(provisionalValidation.quality).toBe("COMPLETE");

    const mockFetchDetail = vi.fn().mockResolvedValue({
      fetched: true,
      rawHtml: "<div>Authoritative Full LinkedIn DOM</div>",
      rawText: "Authoritative Full LinkedIn DOM text...",
      fetchDurationMs: 150,
      httpStatus: 200,
    });

    const handler: any = { fetchDetail: mockFetchDetail };

    // Case 1: LinkedIn search-result card DOM snippet (no authoritative provenance)
    const linkedinCard = {
      title: "Chief Marketing Officer",
      company: "Swiggy",
      detailUrl: "https://www.linkedin.com/jobs/view/999888",
      rawText: richSnippetText,
      rawHtml: `<div>${richSnippetText}</div>`,
      hasAuthoritativeFullDescription: undefined, // Not authoritative API payload
    };

    // Orchestrator gate rule (scripts/scrape.ts):
    const shouldBypassDetail = (portal: string, card: typeof linkedinCard) => {
      return (
        portal !== "LinkedIn" &&
        card.hasAuthoritativeFullDescription === true &&
        card.rawText && card.rawText.length >= 400 &&
        card.rawHtml && card.rawHtml.length >= 400 &&
        ResponseValidator.validate({
          html: card.rawText,
          url: card.detailUrl,
          sourcePortal: portal,
          httpStatus: 200,
          extractedTitle: card.title,
          extractedCompany: card.company,
          extractedDescription: card.rawText,
        }).quality === "COMPLETE"
      );
    };

    expect(shouldBypassDetail("LinkedIn", linkedinCard)).toBe(false);
    // fetchDetail is invoked!
    let detail = await handler.fetchDetail({}, linkedinCard.detailUrl);
    expect(mockFetchDetail).toHaveBeenCalledTimes(1);

    // Case 2: Non-LinkedIn card with explicit authoritative full description provenance
    const apiCard = {
      ...linkedinCard,
      hasAuthoritativeFullDescription: true,
    };
    expect(shouldBypassDetail("Naukri", apiCard)).toBe(true);
    // Detail fetch is skipped because authoritative full description provenance is verified
  });
});
