import { describe, it, expect } from "vitest";
import { extractJobFromHtml } from "../../scripts/scraper/utils/http-fetch";

describe("ATS Content Sanitization & Script Stripping Contract", () => {
  it("strips inline tracking scripts (IIMJobs window.ub pattern) and extracts substantive job text", () => {
    const iimJobsHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Head - Marketing - FinTech - Live Connections</title>
          <script>
            var queuedSuperProps = [];
            var queuedEvents = [];
            window.ub = {
              track: function(name, props) { queuedEvents.push([name, props]); }
            };
          </script>
        </head>
        <body>
          <script>
            window.ub.track("pageview", { portal: "iimjobs" });
          </script>
          <div class="header">
            <nav><a href="/jobs">Search</a></nav>
          </div>
          <div class="job-container">
            <h1 class="job-title">Head - Marketing - FinTech</h1>
            <div class="company-name">Live Connections</div>
            <div class="job-desc">
              <h2>About the Role</h2>
              <p>We are seeking a seasoned Head of Marketing to lead end-to-end commercial growth, brand positioning, and demand generation for a high-growth FinTech scaleup in India.</p>
              <h3>Key Responsibilities</h3>
              <ul>
                <li>Own and manage marketing AOP, performance marketing budget, and customer acquisition CAC/LTV.</li>
                <li>Architect digital transformation across product marketing, lifecycle CRM, and PR.</li>
                <li>Lead a cross-functional marketing team of 15+ professionals across growth, brand, and content.</li>
              </ul>
              <h3>Qualifications</h3>
              <p>10-15 years of leadership experience in FinTech, BFSI, or consumer tech brand marketing.</p>
            </div>
          </div>
          <div class="footer">
            <footer>Copyright 2026 Live Connections. All rights reserved.</footer>
          </div>
        </body>
      </html>
    `;

    const res = extractJobFromHtml(
      iimJobsHtml,
      undefined,
      undefined,
      "Head - Marketing - FinTech",
      "Live Connections"
    );

    expect(res.success).toBe(true);
    expect(res.outcome).toBe("SUCCESS");
    expect(res.quality.tier).toBe("VALID");

    // Invariant: zero script or executable pollution
    expect(res.rawText).not.toContain("window.ub");
    expect(res.rawText).not.toContain("queuedSuperProps");
    expect(res.rawText).not.toContain("function(");
    expect(res.rawText).not.toContain("<script");

    // Substantive job content recovered
    expect(res.rawText).toContain("Head of Marketing");
    expect(res.rawText).toContain("FinTech");
    expect(res.rawText).toContain("Key Responsibilities");
    expect(res.rawText).toContain("marketing AOP");
    expect(res.rawText.length).toBeGreaterThan(400);
  });

  it("strips SuccessFactors inline scripts and cookie policies (Fujitsu pattern)", () => {
    const successFactorsHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            (function() {
              var faviconUrl = '//rmkcdn.successfactors.com/bd8112e7/183d3b2d.png';
              document.head.appendChild(document.createElement('link'));
            })();
          </script>
          <div class="cookie-banner" id="cookie-consent">
            <p>Cookie information: This website is based on the SuccessFactors software.</p>
          </div>
          <div class="job-description" itemprop="description">
            <h1>Service Delivery Director</h1>
            <p><strong>Company:</strong> Fujitsu</p>
            <p><strong>Location:</strong> Bengaluru, India</p>
            <p>The Service Delivery Director will lead enterprise IT operations, service management frameworks, and client SLA governance for global accounts.</p>
            <p>Manage P&L exceeding $50M and lead delivery team of 100+ engineers.</p>
          </div>
        </body>
      </html>
    `;

    const res = extractJobFromHtml(
      successFactorsHtml,
      undefined,
      undefined,
      "Service Delivery Director",
      "Fujitsu"
    );

    expect(res.success).toBe(true);
    expect(res.rawText).not.toContain("faviconUrl");
    expect(res.rawText).not.toContain("rmkcdn.successfactors.com");
    expect(res.rawText).toContain("Service Delivery Director");
    expect(res.rawText.toLowerCase()).toContain("service management frameworks");
  });

  it("strips website navigation trees and header menus (Capgemini pattern)", () => {
    const capgeminiHtml = `
      <html>
        <body>
          <header>
            <nav class="nav-menu">
              Skip to content Insights link Insights Explore our latest thought leadership, ideas, and insights on the future of business.
              Services Industries Careers News About Us
            </nav>
          </header>
          <main>
            <article class="job-desc">
              <h1>SAP Financial Accounting Lead</h1>
              <p>Capgemini is hiring an experienced SAP Financial Accounting Lead for enterprise transformation initiatives.</p>
              <p>Responsibilities include S/4 HANA finance architecture, general ledger governance, and global stakeholder management.</p>
            </article>
          </main>
          <footer>
            Privacy Policy | Terms of Service
          </footer>
        </body>
      </html>
    `;

    const res = extractJobFromHtml(
      capgeminiHtml,
      undefined,
      undefined,
      "SAP Financial Accounting Lead",
      "Capgemini"
    );

    expect(res.success).toBe(true);
    expect(res.rawText).not.toContain("Skip to content Insights");
    expect(res.rawText).not.toContain("Explore our latest thought leadership");
    expect(res.rawText).toContain("SAP Financial Accounting Lead");
    expect(res.rawText).toContain("S/4 HANA finance architecture");
  });
});
