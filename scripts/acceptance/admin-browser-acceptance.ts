import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import { fixture, seedBrowserFixture } from "./browser-fixture";

// Dedicated file database and port: never connects to the live scraper or deployment.
const root = process.cwd(),
  port = 3197,
  url = `http://127.0.0.1:${port}`;
const artifacts = path.join(root, ".radar", "acceptance", "admin");
fs.mkdirSync(artifacts, { recursive: true });
const dbPath = path.join(artifacts, `admin-${Date.now()}.sqlite`);
const dbUrl = pathToFileURL(dbPath).href;
Object.assign(process.env, {
  RADAR_ENV: "dev",
  NODE_ENV: "development",
  TURSO_DATABASE_URL: dbUrl,
  TURSO_CONNECTION_URL: dbUrl,
  TURSO_AUTH_TOKEN: "local-acceptance",
  LLM_PROVIDER: "none",
  ENRICHMENT_MODE: "deterministic",
  GEMINI_API_KEY: "",
  GROQ_API_KEY: "",
  BEDROCK_MANTLE_API_KEY: "",
  AWS_BEARER_TOKEN_BEDROCK: "",
  TAVILY_API_KEY: "",
  GOOGLE_APPLICATION_CREDENTIALS: "",
  RADAR_ADMIN_BENCH_TARGET: "isolated-browser-acceptance",
  RADAR_RELEASE_SHA: "b".repeat(40),
  RADAR_ADMIN_BENCH_HOSTS: hostname(),
});
delete process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT;
const database = await import("../../src/data/database/index");
process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT = database.getDatabaseTargetIdentity().fingerprint;
const { runMigrations } = await import("../../src/data/sqlite/migrations/runner");
await runMigrations();
await database.closeDatabaseAdapter();
await seedBrowserFixture(dbUrl, "local-acceptance");
const db = createClient({ url: dbUrl });
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--strictPort", "--port", String(port)],
  { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout?.on("data", (chunk) => {
  serverLog += String(chunk);
});
server.stderr?.on("data", (chunk) => {
  serverLog += String(chunk);
});
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === "win32" ? "chrome" : undefined,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors: string[] = [];
server.on("exit", (code) => {
  if (code) serverLog += `\nSERVER_EXIT ${code}`;
});
page.on("console", (message) => {
  if (message.type() === "error") serverLog += `\nBROWSER ${message.text()}`;
});
page.on("response", async (response) => {
  if (response.url().includes("_server") && response.status() >= 400)
    serverLog += `\nHTTP ${response.status()} ${await response.text()}`;
});
page.on("pageerror", (error) => errors.push(error.message));
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/login`)).status < 500) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await context.addCookies([
    { name: "radar_session", value: fixture.adminToken, url, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.goto(`${url}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Administration unavailable" }).waitFor();
  await db.execute({
    sql: "INSERT INTO platform_roles(user_id,role,granted_at,granted_by,reason) VALUES (?,'operator',0,'acceptance','browser validation')",
    args: [fixture.adminId],
  });
  await db.execute({
    sql: "UPDATE search_plan_snapshots SET payload_json=? WHERE id='acceptance-snapshot-a'",
    args: [
      JSON.stringify({
        targetRoles: ["VP Marketing"],
        targetSeniority: ["VP"],
        customParameters: { functions: ["Marketing"], generatedQueries: ["VP Marketing"] },
      }),
    ],
  });
  for (const view of [
    "Overview",
    "Engine",
    "Models",
    "Taxonomy",
    "Tenants & Quotas",
    "Operations",
    "Audit",
  ]) {
    await page.goto(`${url}/admin?view=${encodeURIComponent(view)}`, { waitUntil: "networkidle" });
    assert(
      (await page.getByRole("heading", { name: "Administration unavailable" }).count()) === 0,
      `Unavailable view: ${view}`,
    );
    assert(
      (await page.locator('button[aria-current="page"]').count()) === 1,
      `Active navigation: ${view}`,
    );
  }
  await page.goto(`${url}/admin?view=Taxonomy`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "VP Marketing", exact: true }).click();
  await page
    .getByLabel("Taxonomy aliases")
    .fill("VP Marketing\nVice President Marketing\nMarketing VP");
  await page.getByLabel("Taxonomy action reason").fill("Browser acceptance alias edit");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish safe edit" }).waitFor();
  await page.getByRole("button", { name: "Publish safe edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish taxonomy revision" });
  await dialog.waitFor();
  assert((await page.locator("dialog:modal").count()) === 1, "Publish must be modal");
  await page.screenshot({ path: path.join(artifacts, "publish-dialog.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Publish safe edit" }).click();
  await page
    .getByLabel("Taxonomy publication reason")
    .fill("Publish reviewed browser fixture alias");
  await page.getByRole("button", { name: "Publish revision", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Retire concept", exact: true })
    .click({ trial: true })
    .catch(() => {});
  await page.getByLabel("Taxonomy action reason").fill("Retire fixture discovery concept");
  await page.getByRole("button", { name: "Retire concept", exact: true }).click();
  await page.getByRole("button", { name: "Review and publish structural draft" }).click();
  await page.getByLabel("Taxonomy publication reason").fill("Review exact active snapshot queries");
  await page.getByRole("button", { name: "Run query-impact shadow" }).click();
  await page.getByText("Discovery shadow passed", { exact: false }).waitFor();
  assert(
    await page.getByRole("button", { name: "Publish revision", exact: true }).isDisabled(),
    "Structural confirmation must be required",
  );
  await page.getByLabel("Structural publication confirmation").fill("PUBLISH");
  await page.getByRole("button", { name: "Publish revision", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("region", { name: "Intelligence taxonomy", exact: true })
    .getByRole("button", { name: "Performance Marketing", exact: true })
    .click();
  await page.getByLabel("Intelligence classification").selectOption("ADJACENT");
  await page.getByLabel("Intelligence action reason").fill("Browser advisory classification");
  await page.getByRole("button", { name: "Draft classification", exact: true }).click();
  const reviewStructuralDraft = page.getByRole("button", {
    name: "Review and publish structural draft",
  });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent === "Review and publish structural draft" && !button.hasAttribute("disabled"),
      ),
  );
  await reviewStructuralDraft.click();
  await page.getByLabel("Taxonomy publication reason").fill("Compare golden intelligence fixtures");
  assert(
    await page.getByRole("button", { name: "Publish revision", exact: true }).isDisabled(),
    "Intelligence publication must require shadow proof",
  );
  await page.getByRole("button", { name: "Queue admission and verdict shadow" }).click();
  await page
    .getByText("Admission and verdict shadow", { exact: false })
    .filter({ hasText: "queued" })
    .waitFor();
  const { TursoAdapter } = await import("../../src/data/database/turso");
  const { IntelligenceShadowWorker } = await import("../../src/admin/intelligence-shadow-worker");
  const { INTELLIGENCE_SHADOW_VERSION } = await import("../../src/admin/intelligence-shadow");
  const shadowDb = new TursoAdapter(dbUrl, "local-acceptance");
  try {
    const outcome = await new IntelligenceShadowWorker(shadowDb, async (_row, specimens) => ({
      version: INTELLIGENCE_SHADOW_VERSION,
      safeToPublish: true,
      cases: specimens.map(({ id }) => ({
        id,
        beforeAdmission: "CANDIDATE:REVIEW",
        afterAdmission: "CANDIDATE:REVIEW",
        beforeVerdict: id === "mandatory-license" ? "PASS" : "CONSIDER",
        afterVerdict: id === "mandatory-license" ? "PASS" : "CONSIDER",
        beforeViability: id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
        afterViability: id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
      })),
      admissionsChanged: 0,
      verdictsChanged: 0,
      passToPursue: 0,
      invalidOutputs: 0,
      repairs: 0,
    })).pollOnce();
    assert(outcome?.status === "passed", "Fixture comparison worker must pass");
  } finally {
    await shadowDb.close();
  }
  await page.getByRole("button", { name: "Refresh shadow status" }).click();
  await page
    .getByText("Admission and verdict shadow", { exact: false })
    .filter({ hasText: "passed" })
    .waitFor();
  await page.getByLabel("Structural publication confirmation").fill("PUBLISH");
  await page.getByRole("button", { name: "Publish revision", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByLabel("Intelligence action reason")
    .fill("Retire advisory identity for browser proof");
  await page.getByRole("button", { name: "Retire intelligence concept" }).click();
  await page.getByLabel("Show retired identities").check();
  await page.locator('input[aria-label="Intelligence concept name"]:disabled').waitFor();
  assert(
    await page.getByLabel("Intelligence concept name").isDisabled(),
    "Retired identity must remain visible and read-only",
  );
  await page.getByLabel("Taxonomy action reason").fill("Discard retirement browser fixture");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, "taxonomy-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifacts, "taxonomy-mobile.png"), fullPage: true });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "Mobile page overflows viewport",
  );
  await db.execute({
    sql: "UPDATE platform_roles SET role='viewer' WHERE user_id=?",
    args: [fixture.adminId],
  });
  await page.reload({ waitUntil: "networkidle" });
  assert(
    (await page.getByRole("button", { name: "Save draft", exact: true }).count()) === 0,
    "Viewer must not see mutation controls",
  );
  assert(await page.getByLabel("Taxonomy aliases").isDisabled(), "Viewer editor must be read-only");
  assert(
    await page.getByLabel("Intelligence aliases").isDisabled(),
    "Viewer intelligence must be read-only",
  );
  assert(errors.length === 0, `Browser runtime errors: ${errors.join("; ")}`);
  fs.writeFileSync(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        views: 7,
        checks: [
          "tenant admin denied",
          "operator views",
          "alias publish",
          "modal Escape",
          "structural shadow and confirmation",
          "intelligence classification, queued comparison, publish and retirement",
          "mobile overflow",
          "viewer read-only",
          "no page errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Admin browser acceptance passed: seven views, authorization, alias and structural publish, modal keyboard, mobile, viewer.",
  );
} catch (error) {
  fs.writeFileSync(path.join(artifacts, "server.log"), serverLog + "\n" + errors.join("\n"));
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true });
  throw error;
} finally {
  db.close();
  await browser.close();
  server.kill();
}
