import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { chromium, type Browser, type Page } from "playwright";
import {
  attachDecisionsFixtureToActivePlan,
  fixture,
  seedBrowserFixture,
} from "./browser-fixture";

const ROOT = process.cwd();
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(ROOT, ".radar", "acceptance", "browser.sqlite");
const CORPUS_PATH = path.join(ROOT, ".radar", "acceptance", "live-scraped.json");
const DB_URL = pathToFileURL(DB_PATH).href;
const DB_TOKEN = "local-acceptance";
const headed = process.argv.includes("--headed");
const PROVIDER_CREDENTIAL_KEYS = [
  "GEMINI_API_KEY", "GROQ_API_KEY", "BEDROCK_MANTLE_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK", "TAVILY_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ACCEPTANCE_ASSERTION_FAILED: ${message}`);
}

function acceptanceEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RADAR_ENV: "dev",
    NODE_ENV: "development",
    TURSO_CONNECTION_URL: DB_URL,
    TURSO_DATABASE_URL: DB_URL,
    TURSO_AUTH_TOKEN: DB_TOKEN,
    RADAR_EXPECTED_DB_TARGET_FINGERPRINT: process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT,
    LLM_PROVIDER: "none",
    ENRICHMENT_MODE: "deterministic",
    SCRAPER_ARTIFACTS_DIR: path.join(ROOT, ".radar", "acceptance", "artifacts"),
    RADAR_CORPUS_HEALTH_SOURCE_PATH: CORPUS_PATH,
  };
}

async function queryOne<T>(sql: string, args: unknown[] = []): Promise<T | null> {
  const client = createClient({ url: DB_URL, authToken: DB_TOKEN });
  try {
    const result = await client.execute({ sql, args: args as any[] });
    return (result.rows[0] as T | undefined) ?? null;
  } finally {
    client.close();
  }
}

async function prepareDatabase(): Promise<string> {
  for (const key of PROVIDER_CREDENTIAL_KEYS) process.env[key] = "";
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(CORPUS_PATH, JSON.stringify([{
    normalizedText: "Isolated acceptance corpus record for the candidate and administrator browser journey.",
    extractorVersion: "acceptance-fixture",
    dimensions: [{ jdEvidence: { status: "Explicit", value: "Fixture", evidence: ["fixture"] } }],
  }]));
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${DB_PATH}${suffix}`); } catch {}
  }
  process.env.RADAR_ENV = "dev";
  process.env.NODE_ENV = "development";
  process.env.TURSO_CONNECTION_URL = DB_URL;
  process.env.TURSO_DATABASE_URL = DB_URL;
  process.env.TURSO_AUTH_TOKEN = DB_TOKEN;
  process.env.LLM_PROVIDER = "none";
  process.env.ENRICHMENT_MODE = "deterministic";
  process.env.SCRAPER_ARTIFACTS_DIR = path.join(ROOT, ".radar", "acceptance", "artifacts");
  process.env.RADAR_CORPUS_HEALTH_SOURCE_PATH = CORPUS_PATH;
  delete process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT;

  const database = await import("../../src/data/database/index");
  const identity = database.getDatabaseTargetIdentity();
  process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT = identity.fingerprint;
  const { runMigrations } = await import("../../src/data/sqlite/migrations/runner");
  await runMigrations();
  await database.closeDatabaseAdapter();
  await seedBrowserFixture(DB_URL, DB_TOKEN);

  const initial = await queryOne<{ latest: string; active: string }>(
    `SELECT
       (SELECT json_extract(projection_json,'$.profileVersion') FROM career_profiles
        WHERE person_id=? ORDER BY projection_generated_at DESC LIMIT 1) latest,
       (SELECT ec.profile_version FROM active_evaluation_contexts aec
        JOIN evaluation_contexts ec ON ec.context_fingerprint=aec.context_fingerprint
        WHERE aec.tenant_id=? AND aec.person_id=? LIMIT 1) active`,
    [fixture.candidateId, fixture.tenantId, fixture.candidateId],
  );
  assert(initial?.latest === fixture.profileB, "Profile B must be the latest candidate projection.");
  assert(initial?.active === fixture.profileA, "Recommendations must initially remain pinned to Profile A.");
  return identity.fingerprint;
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("ACCEPTANCE_SERVER_START_TIMEOUT");
}

function startVite(env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--strictPort", "--port", String(PORT)],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (chunk) => process.stdout.write(`[acceptance:vite] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[acceptance:vite] ${chunk}`));
  return child;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: !headed });
  } catch (error) {
    if (process.platform === "win32") {
      try {
        return await chromium.launch({ channel: "chrome", headless: !headed });
      } catch {}
    }
    throw error;
  }
}

async function addSession(page: Page, token: string): Promise<void> {
  await page.context().addCookies([{
    name: "radar_session",
    value: token,
    url: BASE_URL,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

async function textareaWithValue(page: Page, fragment: string) {
  const textareas = page.locator("textarea");
  for (let index = 0; index < await textareas.count(); index += 1) {
    const area = textareas.nth(index);
    if ((await area.inputValue()).includes(fragment)) return area;
  }
  throw new Error(`ACCEPTANCE_TEXTAREA_NOT_FOUND: ${fragment}`);
}

async function waitEnabled(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name }).waitFor({ state: "visible" });
  await page.waitForFunction(
    (label) => [...document.querySelectorAll("button")]
      .some((button) => button.textContent?.trim() === label && !button.hasAttribute("disabled")),
    name,
  );
}

async function runCandidateJourney(browser: Browser): Promise<void> {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await addSession(page, fixture.candidateToken);

  await page.goto(`${BASE_URL}/profile`, { waitUntil: "networkidle" });
  await page.getByText("Profile updated", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh recommendations" }).click();
  let refreshed: { profile_version: string; jobs: number } | null = null;
  const refreshDeadline = Date.now() + 15_000;
  while (Date.now() < refreshDeadline) {
    refreshed = await queryOne<{ profile_version: string; jobs: number }>(
      `SELECT ec.profile_version,
         (SELECT COUNT(*) FROM evaluation_jobs WHERE tenant_id=? AND person_id=?) jobs
       FROM active_evaluation_contexts aec
       JOIN search_plans sp ON sp.id=aec.search_plan_id AND sp.status='active'
       JOIN evaluation_contexts ec ON ec.context_fingerprint=aec.context_fingerprint
       WHERE aec.tenant_id=? AND aec.person_id=?
       ORDER BY aec.activated_at DESC LIMIT 1`,
      [fixture.tenantId, fixture.candidateId, fixture.tenantId, fixture.candidateId],
    );
    if (refreshed?.profile_version === fixture.profileB) break;
    await page.waitForTimeout(100);
  }
  assert(refreshed?.profile_version === fixture.profileB, "Refresh must activate Profile B.");
  await page.getByText("Refreshing recommendations…").waitFor({ state: "detached" });
  await page.getByText("Profile updated", { exact: true }).waitFor({ state: "detached" });
  assert(Number(refreshed?.jobs ?? -1) === 0, "Acceptance refresh must not queue model work.");
  await attachDecisionsFixtureToActivePlan(DB_URL, DB_TOKEN);
  await page.goto(`${BASE_URL}/decisions`, { waitUntil: "networkidle" });
  const summary = page.getByTestId(`pursuit-summary-${fixture.jobHash}`);
  await summary.waitFor();
  assert((await summary.textContent())?.includes("Interviewing"), "Decisions must show pursuit stage.");
  assert((await summary.textContent())?.includes("Follow up with search partner"), "Decisions must show next action.");
  assert((await summary.textContent())?.includes("2026-10-03"), "Decisions must show due date.");

  await page.goto(`${BASE_URL}/pursuit/${fixture.jobHash}`, { waitUntil: "networkidle" });
  await page.getByText("Pursuit cockpit", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume" }).click();
  const profileARow = await queryOne<{ profile_version: string }>(
    "SELECT profile_version FROM opportunity_pursuits WHERE id=?",
    [fixture.pursuitId],
  );
  assert(profileARow?.profile_version === fixture.profileA, "Existing pursuit must remain pinned to Profile A.");
  const originalBullet = await textareaWithValue(page, "Grew revenue 40%");
  await originalBullet.click();
  await page.getByTestId("evidence-inspector").getByText(
    "Grew revenue 40% across the enterprise.",
    { exact: false },
  ).waitFor();

  await originalBullet.fill("Grew revenue 400% across the enterprise.");
  await originalBullet.blur();
  await waitEnabled(page, "Mark approved");
  await page.getByRole("button", { name: "Mark approved" }).click();
  const blockers = page.getByTestId("resume-approval-blockers");
  await blockers.waitFor();
  assert((await blockers.textContent())?.includes("400%"), "Approval blocker must identify the unsupported figure.");

  const correctedBullet = await textareaWithValue(page, "Grew revenue 400%");
  await correctedBullet.fill("Grew revenue 40% across the enterprise.");
  await correctedBullet.blur();
  await waitEnabled(page, "Mark approved");
  await page.getByRole("button", { name: "Mark approved" }).click();
  await waitEnabled(page, "Export PDF");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export PDF" }).click(),
  ]);
  const pdfPath = await download.path();
  assert(pdfPath, "Approved resume PDF must download.");
  const pdf = fs.readFileSync(pdfPath!, "latin1");
  assert(pdf.includes("INR 80 crore"), "PDF must normalize the rupee symbol to INR.");
  assert(!pdf.includes("?80 crore"), "PDF must never silently replace the rupee symbol with '?'.");

  const summaryArea = await textareaWithValue(page, "Executive growth leader");
  const validSummary = await summaryArea.inputValue();
  await summaryArea.fill(`${validSummary} 🙂`);
  await summaryArea.blur();
  await waitEnabled(page, "Mark approved");
  await page.getByRole("button", { name: "Mark approved" }).click();
  await waitEnabled(page, "Export PDF");
  await page.getByRole("button", { name: "Export PDF" }).click();
  await page.getByText("PDF_EXPORT_UNSUPPORTED_CHARACTER", { exact: false }).waitFor();

  await page.goto(`${BASE_URL}/corpus`, { waitUntil: "networkidle" });
  await page.getByText("Corpus health unavailable", { exact: true }).waitFor();
  await page.getByText("tenant administrators only", { exact: false }).waitFor();
  assert(await page.getByRole("link", { name: "Corpus" }).count() === 0, "Non-admin navigation must hide Corpus.");

  await context.close();
}

async function runAdminCorpusCheck(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await addSession(page, fixture.adminToken);
  await page.goto(`${BASE_URL}/corpus`, { waitUntil: "networkidle" });
  await page.getByText("Job Intelligence Corpus", { exact: true }).waitFor();
  assert(await page.getByRole("link", { name: "Corpus" }).count() === 1, "Admin navigation must expose Corpus.");
  await context.close();
}

async function main() {
  const fingerprint = await prepareDatabase();
  const env = acceptanceEnv();
  env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT = fingerprint;
  const vite = startVite(env);
  let browser: Browser | null = null;
  try {
    await waitForServer();
    browser = await launchBrowser();
    await runCandidateJourney(browser);
    await runAdminCorpusCheck(browser);
    console.log("\n✅ Isolated authenticated browser acceptance passed.");
    console.log("   - Profile A → Profile B recommendation refresh");
    console.log("   - zero evaluation/model jobs queued by the fixture refresh");
    console.log("   - old Pursuit remains pinned to Profile A evidence");
    console.log("   - approval blocker and corrected approval");
    console.log("   - safe INR PDF export and unsupported-Unicode rejection");
    console.log("   - Decisions pursuit state");
    console.log("   - non-admin/admin Corpus authorization presentation");
    console.log(`   Database: ${DB_PATH}`);
  } finally {
    await browser?.close();
    if (vite.exitCode === null) vite.kill();
  }
}

main().catch((error) => {
  console.error("\n❌ Browser acceptance failed.", error);
  console.error(`Fixture retained for diagnosis: ${DB_PATH}`);
  process.exitCode = 1;
});
