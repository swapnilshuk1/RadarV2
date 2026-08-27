import { getPortalContext } from "../scraper/portals/base";
import path from "path";
import fs from "fs";
import { ResponseValidator } from "../../src/lib/acquisition/validator";
import { resolveCanonicalIdentity } from "../../src/lib/acquisition/canonical-identity";
import { fastFetchDetail } from "../scraper/utils/http-fetch";

export interface CardAuditRow {
  index: number;
  title: string;
  company: string;
  location: string;
  canonicalJobId: string;
  detailUrl: string;
  discoveryPayloadPresent: boolean;
  payloadLength: number;
  fastPathAttempted: boolean;
  fastPathResult: string;
  browserAttempted: boolean;
  browserExtractionLength: number;
  browserMethod?: string;
  richPayloadUsed: boolean;
  validatorResult: {
    isValid: boolean;
    quality: string;
    confidence: string;
    failureClass?: string;
  };
  identityResult: {
    canonicalJobId: string;
    identityConfidence: string;
    identityMethod: string;
  };
  ingestionResult: "NOVEL_ACCEPTED" | "CANONICAL_DUPLICATE" | "VALIDATION_FAILURE" | "IDENTITY_FAILURE";
  classificationDetail: string;
}

async function runControlledCohortAudit() {
  const context = await getPortalContext("Naukri");
  const searchPage = context.pages()[0] || (await context.newPage());
  const keyword = "Vice President Digital";
  const searchUrl = `https://www.naukri.com/vice-president-digital-jobs-in-india?k=${encodeURIComponent(keyword)}`;

  console.log(`\n================================================================`);
  console.log(`   CONTROLLED NAUKRI ACQUISITION MATRIX AUDIT (20–30 CARDS)`);
  console.log(`   Target Query: "${keyword}"`);
  console.log(`================================================================\n`);

  let interceptedApiJobs: any[] = [];
  const onResponse = async (res: any) => {
    if (res.url().includes("jobapi/v3/search") || res.url().includes("aurus-jobseeker-profile-wrapper")) {
      const json = await res.json().catch(() => null);
      if (json && json.jobDetails) {
        interceptedApiJobs.push(...json.jobDetails);
      }
    }
  };
  searchPage.on("response", onResponse);

  console.log(`[Step 1] Loading search page: ${searchUrl}`);
  await searchPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await searchPage.waitForTimeout(4000);

  console.log(`[Step 2] Captured ${interceptedApiJobs.length} jobs from initial page load.`);

  // Test multi-page in-page query evaluation to gather 25-30 live cards
  const page2Jobs = await searchPage.evaluate(async (kw: string) => {
    try {
      const slug = kw.toLowerCase().replace(/\s+/g, "-");
      const url2 = `https://www.naukri.com/jobapi/v3/search?noOfResults=20&urlType=search_by_keyword&searchType=adv&keyword=${encodeURIComponent(kw)}&pageNo=2&k=${encodeURIComponent(kw)}&seoKey=${slug}-jobs-in-india&src=directSearch&latLong=`;
      const res = await fetch(url2, {
        headers: { "appid": "109", "systemid": "NWEB", "clientid": "d3skt0p", "accept": "application/json" }
      });
      if (!res.ok) return [];
      const d = await res.json();
      return d?.jobDetails || [];
    } catch {
      return [];
    }
  }, keyword);

  console.log(`[Step 3] Evaluated Page 2 API call: retrieved ${page2Jobs.length} jobs.`);
  const pooledRaw = [...interceptedApiJobs, ...page2Jobs];

  // Select 25 distinct live cards
  const seenHrefs = new Set<string>();
  const cohort: any[] = [];
  for (const j of pooledRaw) {
    const rawHref = (j.jdURL || j.staticUrl || "").trim();
    if (!rawHref || !j.title || !j.companyName) continue;
    const detailUrl = rawHref.startsWith("http") ? rawHref : `https://www.naukri.com/${rawHref.replace(/^\/+/, "")}`;
    if (seenHrefs.has(detailUrl)) continue;
    seenHrefs.add(detailUrl);
    cohort.push({ ...j, computedDetailUrl: detailUrl });
    if (cohort.length >= 25) break;
  }

  console.log(`[Step 4] Assembled cohort of ${cohort.length} live cards. Beginning per-card execution matrix...\n`);

  const detailPage = await context.newPage();
  const matrix: CardAuditRow[] = [];
  const canonicalLedger = new Set<string>();

  for (let i = 0; i < cohort.length; i++) {
    const job = cohort[i];
    const rawTitle = (job.title || "").trim();
    const rawCompany = (job.companyName || "").trim();
    const rawLoc = (job.placeholders?.find((p: any) => p.type === "location")?.label || job.location || "India").trim();
    const rawDesc = (job.jobDescription || "").trim();
    const detailUrl = job.computedDetailUrl;

    const payloadLen = rawDesc.length;
    const discoveryPayloadPresent = payloadLen > 0;
    const hasRichPayload = payloadLen >= 400;

    let fastPathAttempted = false;
    let fastPathResult = "NOT_ATTEMPTED";
    let browserAttempted = false;
    let browserExtractionLength = 0;
    let browserMethod: string | undefined;
    let richPayloadUsed = false;
    let chosenText = "";

    console.log(`----------------------------------------------------------------`);
    console.log(`[Card #${i + 1}/${cohort.length}] "${rawTitle}" @ "${rawCompany}"`);
    console.log(`URL: ${detailUrl}`);
    console.log(`Discovery Payload in Search API: ${payloadLen} chars (Rich >=400: ${hasRichPayload})`);

    // 1. Identity Resolution (Step 1 in pipeline)
    const identity = resolveCanonicalIdentity({
      portal: "Naukri",
      url: detailUrl,
      title: rawTitle,
      companyName: rawCompany
    });

    // 2. Acquisition Decision
    if (hasRichPayload) {
      richPayloadUsed = true;
      fastPathResult = "BYPASSED_FOR_RICH_PAYLOAD";
      chosenText = [rawTitle, rawCompany, rawLoc, rawDesc.replace(/<[^>]+>/g, " ")].join("\n").replace(/\s+/g, " ").trim();
      console.log(`  -> Action: Rich Discovery Payload USED directly (text length: ${chosenText.length} chars)`);
    } else {
      // Sparsely described or missing in API -> FastPath attempted
      fastPathAttempted = true;
      console.log(`  -> Action: Sparse discovery payload (${payloadLen} chars). Attempting HTTP FastPath...`);
      const httpRes = await fastFetchDetail(
        detailUrl,
        "h1, header, .styles_job-header__container__b1Qf_, [class*='jd-header'], body",
        "[class*='dang-inner-html'], section[class*='job-desc'], [class*='job-desc'], [class*='jobDescription'], div.styles_JDSummary, #job-description, main, article",
        { "appid": "109", "systemid": "NWEB", "Referer": searchUrl }
      );
      
      const httpLen = httpRes.rawText?.length || 0;
      if (httpRes.fetched && httpLen >= 300) {
        fastPathResult = `HTTP_200_SUCCESS (${httpLen} chars)`;
        chosenText = httpRes.rawText!;
      } else {
        fastPathResult = `HTTP_FAILED (${httpRes.httpStatus || "N/A"}, ${httpLen} chars: ${httpRes.fetchError || "Below threshold"})`;
        
        // Browser fallback
        browserAttempted = true;
        console.log(`  -> Action: HTTP FastPath failed (${fastPathResult}). Falling back to Playwright worker tab...`);
        try {
          await detailPage.setExtraHTTPHeaders({
            "Referer": searchUrl,
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
          });
          await detailPage.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await detailPage.waitForTimeout(1000);

          // Attempt 1: __NEXT_DATA__
          const nextDataText = await detailPage.evaluate(() => {
            const el = document.querySelector("#__NEXT_DATA__");
            return el ? el.innerHTML : null;
          });
          
          let extractedJd = "";
          if (nextDataText) {
            try {
              const nd = JSON.parse(nextDataText);
              if (nd?.props?.pageProps?.jobDetails?.jobDescription) {
                extractedJd = nd.props.pageProps.jobDetails.jobDescription;
                browserMethod = "NEXT_DATA";
              }
            } catch {}
          }

          // Attempt 2: DOM Selectors
          if (!extractedJd) {
            const sel = "#jobs-desc, [class*='components_jd'], [class*='dang-inner-html'], [class*='styles_job-desc-container'], .job-description, main, article";
            const count = await detailPage.locator(sel).count();
            if (count > 0) {
              extractedJd = await detailPage.locator(sel).first().innerText();
              browserMethod = "DOM_SELECTOR";
            }
          }

          browserExtractionLength = extractedJd.length;
          chosenText = extractedJd.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          console.log(`  -> Browser Result: Method=${browserMethod || "NONE"}, Length=${browserExtractionLength} chars`);
        } catch (bErr: any) {
          console.log(`  -> Browser Error: ${bErr.message}`);
          browserExtractionLength = 0;
        }
      }
    }

    // 3. Response Validator
    const valResult = ResponseValidator.validate({
      html: chosenText,
      url: detailUrl,
      sourcePortal: "Naukri",
      httpStatus: 200,
      extractedTitle: rawTitle,
      extractedCompany: rawCompany,
      extractedDescription: chosenText
    });

    // 4. Ingestion & Accounting Classification
    let ingestionResult: CardAuditRow["ingestionResult"] = "NOVEL_ACCEPTED";
    let classificationDetail = "";

    if (!valResult.isValid) {
      ingestionResult = "VALIDATION_FAILURE";
      classificationDetail = `Validator rejected (${valResult.failureClass}): textLength=${chosenText.length}`;
    } else if (canonicalLedger.has(identity.canonicalJobId)) {
      ingestionResult = "CANONICAL_DUPLICATE";
      classificationDetail = `Duplicate canonical ID in session: ${identity.canonicalJobId}`;
    } else {
      canonicalLedger.add(identity.canonicalJobId);
      ingestionResult = "NOVEL_ACCEPTED";
      classificationDetail = `Ingested as canonical opportunity (${valResult.quality}, ${chosenText.length} chars)`;
    }

    console.log(`  -> Final Accounting: [${ingestionResult}] - ${classificationDetail}`);

    matrix.push({
      index: i + 1,
      title: rawTitle,
      company: rawCompany,
      location: rawLoc,
      canonicalJobId: identity.canonicalJobId,
      detailUrl,
      discoveryPayloadPresent,
      payloadLength: payloadLen,
      fastPathAttempted,
      fastPathResult,
      browserAttempted,
      browserExtractionLength,
      browserMethod,
      richPayloadUsed,
      validatorResult: {
        isValid: valResult.isValid,
        quality: valResult.quality,
        confidence: valResult.confidence,
        failureClass: valResult.failureClass
      },
      identityResult: {
        canonicalJobId: identity.canonicalJobId,
        identityConfidence: identity.identityConfidence,
        identityMethod: identity.identityMethod
      },
      ingestionResult,
      classificationDetail
    });
  }

  const outPath = path.join(process.cwd(), ".scraper-artifacts", "audit_naukri_matrix_results.json");
  fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2), "utf8");
  console.log(`\n================================================================`);
  console.log(`AUDIT COMPLETE. Matrix of ${matrix.length} cards saved to: ${outPath}`);
  console.log(`================================================================\n`);

  searchPage.off("response", onResponse);
  await detailPage.close();
  await context.close();
}

runControlledCohortAudit().catch(console.error);
