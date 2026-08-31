import { describe, it, expect } from "vitest";
import { extractJobFromHtml, extractValidatedJsonLd } from "../../scripts/scraper/utils/http-fetch";

describe("ATS JSON-LD Extraction & Validation Contract", () => {
  it("prioritizes validated schema.org JobPosting JSON-LD over ambiguous DOM containers", () => {
    const htmlWithJsonLd = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Vice President of Growth",
              "hiringOrganization": {
                "@type": "Organization",
                "name": "Laters Travel Tech"
              },
              "description": "<p>Laters is looking for a Vice President of Growth to oversee commercial acquisition, retention marketing, and regional growth across Southeast Asia. The VP Growth will manage multi-million dollar performance budgets, scale conversion funnels, and lead cross-functional product-growth squads across multiple countries.</p><p>Key Responsibilities include defining customer acquisition strategy, managing CAC/LTV payback, scaling digital media channels, and building a high-performing growth marketing organization. Requirements: 10+ years in high-growth marketplace tech, proven track record of scaling digital businesses, and deep expertise in consumer performance marketing and data analytics.</p>"
            }
          </script>
        </head>
        <body>
          <div class="unstructured-layout">
            <p>Welcome to our careers page. Click apply below to submit your resume.</p>
          </div>
        </body>
      </html>
    `;

    const res = extractJobFromHtml(htmlWithJsonLd);
    expect(res.success).toBe(true);
    expect(res.method).toBe("JSON_LD");
    expect(res.rawText).toContain("Vice President of Growth");
    expect(res.rawText).toContain("Laters Travel Tech");
    expect(res.rawText).toContain("commercial acquisition, retention marketing");
    expect(res.quality.tier).toBe("VALID");
  });

  it("handles @graph array structures in JSON-LD", () => {
    const htmlWithGraph = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "BreadcrumbList"
                },
                {
                  "@type": "JobPosting",
                  "title": "Head of Digital Marketing",
                  "hiringOrganization": {
                    "@type": "Organization",
                    "name": "Ascendion"
                  },
                  "description": "<p>Lead global digital marketing, search engine visibility, brand advertising, and enterprise ABM strategies. Requires 12+ years experience leading enterprise marketing organizations, managing digital transformation, and executing omnichannel demand generation programs across global markets.</p>"
                }
              ]
            }
          </script>
        </head>
        <body>
          <div class="content">Fallback text</div>
        </body>
      </html>
    `;

    const validated = extractValidatedJsonLd(htmlWithGraph);
    expect(validated).not.toBeNull();
    expect(validated?.title).toBe("Head of Digital Marketing");
    expect(validated?.company).toBe("Ascendion");
    expect(validated?.rawText).toContain("enterprise ABM strategies");
  });

  it("rejects invalid/stub JSON-LD (description < 150 chars or missing title) and falls back to DOM", () => {
    const htmlWithStubJsonLd = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "",
              "description": "Short placeholder"
            }
          </script>
        </head>
        <body>
          <main class="job-desc">
            <h1>Director of Engineering</h1>
            <p>We are looking for a Director of Engineering to lead our distributed platform engineering organization. You will manage engineering directors, set the technical vision for cloud architecture, and establish engineering excellence standards.</p>
          </main>
        </body>
      </html>
    `;

    const validated = extractValidatedJsonLd(htmlWithStubJsonLd);
    expect(validated).toBeNull();

    const res = extractJobFromHtml(htmlWithStubJsonLd);
    expect(res.success).toBe(true);
    expect(res.method).toBe("TARGETED_DOM");
    expect(res.rawText).toContain("Director of Engineering");
    expect(res.rawText).toContain("distributed platform engineering organization");
  });
});
