/** Deterministic isolated Admin acceptance; never contacts a provider or webhook. */
import type { Browser, Page } from "playwright";
import { getDatabaseAdapter } from "../../src/data/database";
import { fixture } from "./browser-fixture";
import { seedOperationalEvaluation, completeOperationalMemo } from "./operations-fixture";
import { ProductionContextProvider } from "../../src/evaluation/context-provider";
import {
  registerConnectionWorker,
  pollSearchConnectionCheck,
  refreshSearchWorkerReceipt,
} from "../../src/admin/search-connections";
import { CredentialVault } from "../../src/lib/security/CredentialVault";
import { pollNotificationDelivery } from "../../src/admin/notification-worker";
import { reconcileProviderIncidents } from "../../src/admin/operations-recovery";
import { notificationSignature } from "../../src/admin/notification-worker";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function operation(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Operation recorded." }).waitFor();
}
export async function runOperationsBrowserJourney(
  browser: Browser,
  baseUrl: string,
  fingerprint: string,
) {
  const db = getDatabaseAdapter();
  await db.execute(
    "INSERT INTO platform_roles VALUES(?,'operator',0,'acceptance','acceptance',NULL)",
    [fixture.adminId],
  );
  const identity = {
    tenantId: fixture.tenantId,
    personId: fixture.candidateId,
    canonicalJobId: fixture.canonicalJobId,
    opportunityVersion: fixture.opportunityVersion,
    evaluationContextFingerprint: fixture.contextA,
    profileVersion: fixture.profileA,
  };
  const work = await seedOperationalEvaluation(db, identity, fixture.planA);
  const instance = "operations-acceptance-worker";
  await db.execute("INSERT INTO worker_heartbeats VALUES('evaluation',?,'development',?,?)", [
    instance,
    fingerprint,
    new Date().toISOString(),
  ]);
  registerConnectionWorker("evaluation", instance, fingerprint);
  const signingSecret = "acceptance-signing-secret-000000000000000";
  await db.execute("INSERT INTO operational_webhooks VALUES(1,?,?,?,?,?,?)", [
    "https://alerts.example.com/radar",
    JSON.stringify(new CredentialVault().encrypt(signingSecret)),
    "High",
    1,
    Date.now(),
    fixture.adminId,
  ]);
  process.env.TAVILY_API_KEY = "acceptance-host-key";
  const opportunity = { id: identity.canonicalJobId, title: "Head of Growth", company: "Company" };
  await new ProductionContextProvider(
    db,
    fixture.tenantId,
    async () => new Response(JSON.stringify({ results: [] })),
    undefined,
    work,
  ).acquire(opportunity, ["companySize"]);
  try {
    await new ProductionContextProvider(
      db,
      fixture.tenantId,
      async () => new Response("", { status: 401 }),
      undefined,
      work,
    ).acquire(opportunity, ["companySize"]);
    throw new Error("credential rejection missing");
  } catch (e) {
    assert(
      e instanceof Error && e.message === "CONTEXT_SEARCH_HTTP_401",
      "unexpected provider failure",
    );
  }
  const incident = (await db.one<{ id: string }>("SELECT id FROM provider_incidents"))!;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await context.addCookies([
    {
      name: "radar_session",
      value: fixture.adminToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${baseUrl}/admin?view=Connections`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Tavily connection", exact: true }).waitFor();
  await page.getByLabel("Operational change reason").fill("Recover isolated credential incident");
  const candidateKey = "tvly-" + "z".repeat(30);
  await page.getByLabel("Replacement Tavily key").fill(candidateKey);
  await operation(page, "Save candidate");
  assert(
    (await page.getByLabel("Replacement Tavily key").inputValue()) === "",
    "secret input retained",
  );
  await operation(page, "Validate on worker");
  await pollSearchConnectionCheck(db, async () => new Response("", { status: 401 }));
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await page.getByText("CONTEXT_SEARCH_HTTP_401", { exact: true }).waitFor();
  assert(
    (await db.one<{ active_id: string | null }>("SELECT active_id FROM admin_search_connection"))!
      .active_id === null,
    "failed candidate activated",
  );
  await operation(page, "Validate on worker");
  await pollSearchConnectionCheck(db, async () => new Response(JSON.stringify({ results: [] })));
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await operation(page, "Activate validated candidate");
  await refreshSearchWorkerReceipt(db);
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await page.getByText("Workers loaded: 1/1", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Select recovery cohort", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await operation(page, "Preview selected work");
  await operation(page, "Resume 1 selected jobs");
  await completeOperationalMemo(db, identity, work.jobId);
  await reconcileProviderIncidents(db);
  const send = async (_url: string, body: string, secret: string, eventId: string) => {
    assert(secret === signingSecret, "signing secret mismatch");
    assert(JSON.parse(body).eventId === eventId, "event identity missing");
    assert(
      notificationSignature(secret, String(Date.now()), body).length === 64,
      "signature missing",
    );
    return 204;
  };
  await pollNotificationDelivery(db, send);
  await pollNotificationDelivery(db, send);
  assert(
    (await db.one<{ state: string }>("SELECT state FROM provider_incidents WHERE id=?", [
      incident.id,
    ]))!.state === "resolved",
    "incident did not resolve",
  );
  assert(
    await db.one(
      "SELECT id FROM notification_deliveries WHERE event='resolved' AND status='delivered'",
    ),
    "signed recovery delivery missing",
  );
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await page.getByText("resolved · 1 observations", { exact: false }).waitFor();
  assert(
    !(await page.locator("body").innerText()).includes(candidateKey),
    "credential disclosed in rendered page",
  );
  await page.screenshot({ path: ".radar/acceptance/operations.png", fullPage: true });
  await context.close();
}
