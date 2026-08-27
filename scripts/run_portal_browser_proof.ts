import fs from "node:fs";
import path from "node:path";
import { getPortalContext, closeAllPortalContexts } from "./scraper/portals/base";
import { ResponseValidator } from "../src/lib/acquisition/validator";

interface TraceResult {
  recordName: string;
  canonicalJobId: string;
  sourcePortal: string;
  canonicalUrl: string;
  browserContextInfo: {
    userDataDir: string;
    userAgent: string;
    viewport: { width: number; height: number };
  };
  navigation: {
    start: string;
    durationMs: number;
    waitUntil: string;
  };
  redirectChain: string[];
  finalUrl: string;
  httpStatus: number | null;
  pageTitle: string;
  domReadyState: string;
  hydrationSignals: {
    hasRoot: boolean;
    hasNext: boolean;
    hasAngular: boolean;
    hasReact: boolean;
    bodyLength: number;
  };
  candidateSelectorsTested: Array<{
    selector: string;
    count: number;
    textLength: number;
  }>;
  matchedSelector: string | null;
  extractedRawTextLength: number;
  extractedNormalizedTextLength: number;
  extractedTextPreview500: string;
  titleFound: boolean;
  companyFound: boolean;
  expectedContainerExists: boolean;
  containerHasEmptyText: boolean;
  contentAppearsAfterAdditionalTime: boolean;
  contentAppearsAfterScroll: boolean;
  cloudflareAuthwallVisible: boolean;
  responseValidatorResult: any;
  acquisitionStatus: string;
  acquisitionQuality: string;
  failureClass: string | null;
  snapshotPath?: string;
  screenshotPath?: string;
  classification: "A. BROWSER CAN RECOVER SOURCE" | "B. BROWSER REACHES SOURCE BUT EXTRACTION FAILS" | "C. BROWSER CANNOT REACH SOURCE" | "D. SOURCE ITSELF IS NO LONGER AVAILABLE" | "E. SOURCE IS REACHED AND VERIFIED GENUINELY SPARSE";
}

async function runBrowserProof() {
  const artifactsDir = path.resolve(process.cwd(), "docs/artifacts");
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const results: TraceResult[] = [];

  // ==========================================
  // TEST 1: INDEED (j-a8b9e9a27827)
  // ==========================================
  console.log("\n=======================================================");
  console.log("TEST 1: INDEED - Digital Advisory Director (j-a8b9e9a27827)");
  console.log("Canonical URL: https://in.indeed.com/rc/clk?jk=cdfc18533516735f");
  console.log("=======================================================");

  const indeedCtx = await getPortalContext("Indeed");
  const indeedPage = await indeedCtx.newPage();

  const redirectChain1: string[] = [];
  let httpStatus1: number | null = null;

  indeedPage.on("response", (res: any) => {
    const url = res.url();
    const status = res.status();
    if (redirectChain1.length === 0 || redirectChain1[redirectChain1.length - 1] !== url) {
      redirectChain1.push(url);
    }
    if (url.includes("in.indeed.com/rc/clk") || url.includes("accordion") || url.includes("workday")) {
      httpStatus1 = status;
    }
  });

  const t0_indeed = Date.now();
  let indeedNavErr: string | null = null;
  try {
    const navRes = await indeedPage.goto("https://in.indeed.com/rc/clk?jk=cdfc18533516735f", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (navRes && !httpStatus1) httpStatus1 = navRes.status();
  } catch (err: any) {
    indeedNavErr = err.message;
  }
  const indeedNavDuration = Date.now() - t0_indeed;

  // Let client-side redirects and network settle
  await indeedPage.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));

  const finalUrl1 = indeedPage.url();
  const pageTitle1 = await indeedPage.title().catch(() => "");
  const domReadyState1 = await indeedPage.evaluate(() => document.readyState).catch(() => "unknown");
  const bodyText1 = await indeedPage.evaluate(() => document.body?.innerText || "").catch(() => "");
  const bodyHtml1 = await indeedPage.evaluate(() => document.documentElement?.outerHTML || "").catch(() => "");

  const hydration1 = await indeedPage.evaluate(() => ({
    hasRoot: !!document.getElementById("root"),
    hasNext: !!document.getElementById("__next"),
    hasAngular: !!document.querySelector("[ng-version]"),
    hasReact: !!document.querySelector("[data-reactroot], [data-reacthost]"),
    bodyLength: (document.body?.innerText || "").length,
  })).catch(() => ({ hasRoot: false, hasNext: false, hasAngular: false, hasReact: false, bodyLength: 0 }));

  const cloudflare1 = /just a moment|access denied|attention required|security check|cloudflare|cf-challenge/i.test(pageTitle1 + " " + bodyText1);

  const indeedCandidateSelectors = [
    "#jobDescriptionText",
    ".jobsearch-jobDescriptionText",
    "[data-testid='jobsearch-JobComponent-description']",
    "[data-automation-id='jobPostingDescription']", // Workday
    "#content",
    ".posting-requirements",
    ".job-description",
    "#job-description",
    ".job__description",
    ".job-details",
    ".description__text",
    "[class*='JobDescription']",
    "main",
    "article",
    "[role='main']",
  ];

  const testedSelectors1: TraceResult["candidateSelectorsTested"] = [];
  let matchedSel1: string | null = null;
  let extractedText1 = "";
  let extractedHtml1 = "";

  for (const sel of indeedCandidateSelectors) {
    const count = await indeedPage.locator(sel).count().catch(() => 0);
    let len = 0;
    if (count > 0) {
      const txt = ((await indeedPage.locator(sel).first().textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
      len = txt.length;
      if (len >= 200 && !matchedSel1) {
        matchedSel1 = sel;
        extractedText1 = txt;
        extractedHtml1 = (await indeedPage.locator(sel).first().innerHTML().catch(() => "")) || "";
      }
    }
    testedSelectors1.push({ selector: sel, count, textLength: len });
  }

  // If no primary selector matched, check if body has rich text
  if (!matchedSel1 && bodyText1.length >= 200) {
    matchedSel1 = "body";
    extractedText1 = bodyText1.replace(/\s+/g, " ").trim();
    extractedHtml1 = bodyHtml1;
  }

  const titleFound1 = /digital advisory director/i.test(bodyText1) || /digital advisory director/i.test(pageTitle1);
  const companyFound1 = /accordion/i.test(bodyText1) || /accordion/i.test(pageTitle1);
  const containerExists1 = testedSelectors1.some((s) => s.count > 0);
  const containerHasEmptyText1 = containerExists1 && extractedText1.length === 0;

  // Check additional time & scroll
  let contentAppearsAfterAdditionalTime1 = false;
  let contentAppearsAfterScroll1 = false;
  if (extractedText1.length < 200) {
    await new Promise((r) => setTimeout(r, 4000));
    const postTimeText = await indeedPage.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (postTimeText.length > bodyText1.length + 100) contentAppearsAfterAdditionalTime1 = true;

    await indeedPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 2000));
    const postScrollText = await indeedPage.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (postScrollText.length > postTimeText.length + 100) contentAppearsAfterScroll1 = true;
  }

  const snapshot1Path = path.join(artifactsDir, "indeed_j-a8b9e9a27827.html");
  const screenshot1Path = path.join(artifactsDir, "indeed_j-a8b9e9a27827.png");
  fs.writeFileSync(snapshot1Path, bodyHtml1, "utf-8");
  await indeedPage.screenshot({ path: screenshot1Path, fullPage: true }).catch(() => {});

  const val1 = ResponseValidator.validate({
    html: bodyHtml1,
    url: finalUrl1,
    sourcePortal: "Indeed",
    httpStatus: httpStatus1 ?? 200,
    extractedTitle: titleFound1 ? "Digital Advisory Director" : undefined,
    extractedCompany: companyFound1 ? "Accordion" : undefined,
    extractedDescription: extractedText1,
  });

  let classification1: TraceResult["classification"] = "C. BROWSER CANNOT REACH SOURCE";
  if (val1.isValid && extractedText1.length >= 200) {
    classification1 = "A. BROWSER CAN RECOVER SOURCE";
  } else if (/not found|404|expired|no longer available|closed/i.test(pageTitle1 + " " + bodyText1)) {
    classification1 = "D. SOURCE ITSELF IS NO LONGER AVAILABLE";
  } else if (containerExists1 && extractedText1.length < 200 && !cloudflare1) {
    classification1 = "B. BROWSER REACHES SOURCE BUT EXTRACTION FAILS";
  } else if (cloudflare1) {
    classification1 = "C. BROWSER CANNOT REACH SOURCE";
  }

  results.push({
    recordName: "Digital Advisory Director (Accordion)",
    canonicalJobId: "j-a8b9e9a27827",
    sourcePortal: "Indeed",
    canonicalUrl: "https://in.indeed.com/rc/clk?jk=cdfc18533516735f",
    browserContextInfo: {
      userDataDir: ".scraper-cache/profiles/indeed",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0",
      viewport: { width: 1280, height: 800 },
    },
    navigation: {
      start: new Date(t0_indeed).toISOString(),
      durationMs: indeedNavDuration,
      waitUntil: "domcontentloaded",
    },
    redirectChain: redirectChain1,
    finalUrl: finalUrl1,
    httpStatus: httpStatus1,
    pageTitle: pageTitle1,
    domReadyState: domReadyState1,
    hydrationSignals: hydration1,
    candidateSelectorsTested: testedSelectors1,
    matchedSelector: matchedSel1,
    extractedRawTextLength: extractedText1.length,
    extractedNormalizedTextLength: extractedText1.replace(/\s+/g, " ").trim().length,
    extractedTextPreview500: extractedText1.slice(0, 500),
    titleFound: titleFound1,
    companyFound: companyFound1,
    expectedContainerExists: containerExists1,
    containerHasEmptyText: containerHasEmptyText1,
    contentAppearsAfterAdditionalTime: contentAppearsAfterAdditionalTime1,
    contentAppearsAfterScroll: contentAppearsAfterScroll1,
    cloudflareAuthwallVisible: cloudflare1,
    responseValidatorResult: val1,
    acquisitionStatus: val1.isValid ? "ACQUIRED" : "CAPTURE_FAILED",
    acquisitionQuality: val1.quality,
    failureClass: val1.failureClass || null,
    snapshotPath: snapshot1Path,
    screenshotPath: screenshot1Path,
    classification: classification1,
  });

  await indeedPage.close().catch(() => {});

  // ==========================================
  // TEST 2: NAUKRI (j-dca748b4c4c8)
  // ==========================================
  console.log("\n=======================================================");
  console.log("TEST 2: NAUKRI - Marketing Manager Healthcare (j-dca748b4c4c8)");
  console.log("Canonical URL: https://www.naukri.com/job-listings-marketing-manager-healthcare-thrissur-kerala-vesat-management-thrissur-8-to-12-years-040826023823");
  console.log("=======================================================");

  const naukriCtx = await getPortalContext("Naukri");
  const naukriPage = await naukriCtx.newPage();

  const redirectChain2: string[] = [];
  let httpStatus2: number | null = null;

  naukriPage.on("response", (res: any) => {
    const url = res.url();
    const status = res.status();
    if (redirectChain2.length === 0 || redirectChain2[redirectChain2.length - 1] !== url) {
      redirectChain2.push(url);
    }
    if (url.includes("naukri.com/job-listings")) {
      httpStatus2 = status;
    }
  });

  const t0_naukri = Date.now();
  let naukriNavErr: string | null = null;
  try {
    const navRes = await naukriPage.goto("https://www.naukri.com/job-listings-marketing-manager-healthcare-thrissur-kerala-vesat-management-thrissur-8-to-12-years-040826023823", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (navRes && !httpStatus2) httpStatus2 = navRes.status();
  } catch (err: any) {
    naukriNavErr = err.message;
  }
  const naukriNavDuration = Date.now() - t0_naukri;

  // Let client-side React hydration settle
  await naukriPage.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));

  const finalUrl2 = naukriPage.url();
  const pageTitle2 = await naukriPage.title().catch(() => "");
  const domReadyState2 = await naukriPage.evaluate(() => document.readyState).catch(() => "unknown");
  const bodyText2 = await naukriPage.evaluate(() => document.body?.innerText || "").catch(() => "");
  const bodyHtml2 = await naukriPage.evaluate(() => document.documentElement?.outerHTML || "").catch(() => "");

  const hydration2 = await naukriPage.evaluate(() => ({
    hasRoot: !!document.getElementById("root"),
    hasNext: !!document.getElementById("__next"),
    hasAngular: !!document.querySelector("[ng-version]"),
    hasReact: !!document.querySelector("[data-reactroot], [data-reacthost]"),
    bodyLength: (document.body?.innerText || "").length,
  })).catch(() => ({ hasRoot: false, hasNext: false, hasAngular: false, hasReact: false, bodyLength: 0 }));

  const cloudflare2 = /just a moment|access denied|attention required|security check|cloudflare|cf-challenge/i.test(pageTitle2 + " " + bodyText2);

  const naukriCandidateSelectors = [
    "[class*='styles_job-desc-container']",
    "section[class*='job-desc']",
    "[class*='job-desc']",
    "div[class*='JDSummary']",
    "[class*='styles_JDJobs-recJob-desc']",
    "[class*='dang-inner-html']",
    "[class*='styles_key-skill']",
    "[class*='key-skill']",
    "[class*='jobDescription']",
    "#job-description",
    "main",
    "article",
    "[role='main']",
  ];

  const testedSelectors2: TraceResult["candidateSelectorsTested"] = [];
  let matchedSel2: string | null = null;
  let extractedText2 = "";
  let extractedHtml2 = "";

  for (const sel of naukriCandidateSelectors) {
    const count = await naukriPage.locator(sel).count().catch(() => 0);
    let len = 0;
    if (count > 0) {
      const txt = ((await naukriPage.locator(sel).first().textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
      len = txt.length;
      if (len >= 150 && !matchedSel2) {
        matchedSel2 = sel;
        extractedText2 = txt;
        extractedHtml2 = (await naukriPage.locator(sel).first().innerHTML().catch(() => "")) || "";
      }
    }
    testedSelectors2.push({ selector: sel, count, textLength: len });
  }

  // Check composite extraction (as implemented in naukri.ts fetchDetail)
  if (!matchedSel2 || extractedText2.length < 300) {
    const compositeParts: string[] = [];
    const mainDesc = testedSelectors2.find((s) => s.selector === "[class*='styles_job-desc-container']" || s.selector === "section[class*='job-desc']");
    if (mainDesc && mainDesc.textLength > 0) {
      compositeParts.push((await naukriPage.locator(mainDesc.selector).first().textContent().catch(() => "")) || "");
    }
    const dangLoc = naukriPage.locator("[class*='dang-inner-html']").first();
    const dangTxt = ((await dangLoc.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (dangTxt.length > 50 && !compositeParts.some((p) => p.includes(dangTxt.slice(0, 50)))) {
      compositeParts.push(dangTxt);
    }
    const skillLoc = naukriPage.locator("[class*='styles_key-skill'], [class*='key-skill']").first();
    const skillTxt = ((await skillLoc.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (skillTxt.length > 30) {
      compositeParts.push(`Key Skills: ${skillTxt}`);
    }

    if (compositeParts.length > 0) {
      extractedText2 = compositeParts.join("\n\n").replace(/\s+/g, " ").trim();
      if (!matchedSel2) matchedSel2 = "COMPOSITE_NAUKRI_CONTAINERS";
    }
  }

  if (!matchedSel2 && bodyText2.length >= 200) {
    matchedSel2 = "body";
    extractedText2 = bodyText2.replace(/\s+/g, " ").trim();
    extractedHtml2 = bodyHtml2;
  }

  const titleFound2 = /marketing manager/i.test(bodyText2) || /marketing manager/i.test(pageTitle2);
  const companyFound2 = /reputed|vesat/i.test(bodyText2) || /reputed|vesat/i.test(pageTitle2);
  const containerExists2 = testedSelectors2.some((s) => s.count > 0);
  const containerHasEmptyText2 = containerExists2 && extractedText2.length === 0;

  let contentAppearsAfterAdditionalTime2 = false;
  let contentAppearsAfterScroll2 = false;
  if (extractedText2.length < 200) {
    await new Promise((r) => setTimeout(r, 4000));
    const postTimeText = await naukriPage.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (postTimeText.length > bodyText2.length + 100) contentAppearsAfterAdditionalTime2 = true;

    await naukriPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 2000));
    const postScrollText = await naukriPage.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (postScrollText.length > postTimeText.length + 100) contentAppearsAfterScroll2 = true;
  }

  const snapshot2Path = path.join(artifactsDir, "naukri_j-dca748b4c4c8.html");
  const screenshot2Path = path.join(artifactsDir, "naukri_j-dca748b4c4c8.png");
  fs.writeFileSync(snapshot2Path, bodyHtml2, "utf-8");
  await naukriPage.screenshot({ path: screenshot2Path, fullPage: true }).catch(() => {});

  const val2 = ResponseValidator.validate({
    html: bodyHtml2,
    url: finalUrl2,
    sourcePortal: "Naukri",
    httpStatus: httpStatus2 ?? 200,
    extractedTitle: titleFound2 ? "Marketing Manager-Healthcare" : undefined,
    extractedCompany: companyFound2 ? "REPUTED GROUP" : undefined,
    extractedDescription: extractedText2,
  });

  let classification2: TraceResult["classification"] = "C. BROWSER CANNOT REACH SOURCE";
  if (val2.isValid && extractedText2.length >= 200) {
    classification2 = "A. BROWSER CAN RECOVER SOURCE";
  } else if (/not found|404|expired|no longer available|closed|inactive/i.test(pageTitle2 + " " + bodyText2)) {
    classification2 = "D. SOURCE ITSELF IS NO LONGER AVAILABLE";
  } else if (containerExists2 && extractedText2.length < 200 && !cloudflare2) {
    classification2 = "B. BROWSER REACHES SOURCE BUT EXTRACTION FAILS";
  } else if (cloudflare2) {
    classification2 = "C. BROWSER CANNOT REACH SOURCE";
  }

  results.push({
    recordName: "Marketing Manager Healthcare (REPUTED GROUP)",
    canonicalJobId: "j-dca748b4c4c8",
    sourcePortal: "Naukri",
    canonicalUrl: "https://www.naukri.com/job-listings-marketing-manager-healthcare-thrissur-kerala-vesat-management-thrissur-8-to-12-years-040826023823",
    browserContextInfo: {
      userDataDir: ".scraper-cache/profiles/naukri",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0",
      viewport: { width: 1280, height: 800 },
    },
    navigation: {
      start: new Date(t0_naukri).toISOString(),
      durationMs: naukriNavDuration,
      waitUntil: "domcontentloaded",
    },
    redirectChain: redirectChain2,
    finalUrl: finalUrl2,
    httpStatus: httpStatus2,
    pageTitle: pageTitle2,
    domReadyState: domReadyState2,
    hydrationSignals: hydration2,
    candidateSelectorsTested: testedSelectors2,
    matchedSelector: matchedSel2,
    extractedRawTextLength: extractedText2.length,
    extractedNormalizedTextLength: extractedText2.replace(/\s+/g, " ").trim().length,
    extractedTextPreview500: extractedText2.slice(0, 500),
    titleFound: titleFound2,
    companyFound: companyFound2,
    expectedContainerExists: containerExists2,
    containerHasEmptyText: containerHasEmptyText2,
    contentAppearsAfterAdditionalTime: contentAppearsAfterAdditionalTime2,
    contentAppearsAfterScroll: contentAppearsAfterScroll2,
    cloudflareAuthwallVisible: cloudflare2,
    responseValidatorResult: val2,
    acquisitionStatus: val2.isValid ? "ACQUIRED" : "CAPTURE_FAILED",
    acquisitionQuality: val2.quality,
    failureClass: val2.failureClass || null,
    snapshotPath: snapshot2Path,
    screenshotPath: screenshot2Path,
    classification: classification2,
  });

  await naukriPage.close().catch(() => {});
  await closeAllPortalContexts();

  const outPath = path.resolve(process.cwd(), "scripts/portal_browser_proof_results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nResults written to: ${outPath}`);
}

runBrowserProof().catch((err) => {
  console.error("FATAL BROWSER PROOF RUNNER ERROR:", err);
  process.exit(1);
});
