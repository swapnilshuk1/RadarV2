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
import { associateIncidentWork, observeProviderFailure } from "../../src/admin/operations-runtime";
import {
  CRITICAL_EVALUATION_MAINTENANCE_TASKS,
  runMaintenanceTasks,
} from "../../src/lib/health/maintenance-receipts";

const tavilyCapabilityResponse = () =>
  new Response(
    JSON.stringify({
      results: [{ url: "https://oracle.com", raw_content: "fixture official company content" }],
    }),
  );

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
  const terminalVersion = "operations-terminal-version";
  const terminalCanonical = "operations-terminal-canonical";
  await db.execute(
    "INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES(?,'fixture',?,'https://example.com/terminal-job')",
    [terminalCanonical, terminalCanonical],
  );
  await db.execute(
    "INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content) VALUES(?,?,'operations-terminal-hash','Head of Growth','Lead growth')",
    [terminalVersion, terminalCanonical],
  );
  await db.execute(
    "INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,eligibility) VALUES(?,?,?,?,?,'CANDIDATE','ELIGIBLE')",
    [identity.tenantId, identity.personId, fixture.planA, terminalCanonical, terminalVersion],
  );
  await db.execute(
    "INSERT INTO evaluation_jobs(id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,status) VALUES('operations-terminal-job',?,?,?,?,?,?,'staged_dead_letter')",
    [
      identity.tenantId,
      identity.personId,
      fixture.planA,
      terminalCanonical,
      terminalVersion,
      identity.evaluationContextFingerprint,
    ],
  );
  const instance = "operations-acceptance-worker";
  const releaseSha = process.env.RADAR_RELEASE_SHA ?? "development";
  await db.execute("INSERT INTO worker_heartbeats VALUES('evaluation',?,?,?,?)", [
    instance,
    releaseSha,
    fingerprint,
    new Date().toISOString(),
  ]);
  registerConnectionWorker("evaluation", instance, fingerprint);
  const signingSecret = "acceptance-signing-secret-000000000000000";
  await db.execute(
    `INSERT INTO operational_webhooks(id,url,secret_envelope,minimum_severity,send_recovery,updated_at,updated_by)
     VALUES(1,?,?,?,?,?,?)`,
    [
      "https://alerts.example.com/radar",
      JSON.stringify(new CredentialVault().encrypt(signingSecret)),
      "High",
      1,
      Date.now(),
      fixture.adminId,
    ],
  );
  await runMaintenanceTasks(
    db,
    { workerInstance: instance, releaseSha, databaseFingerprint: fingerprint },
    CRITICAL_EVALUATION_MAINTENANCE_TASKS.map((task) => ({
      task,
      operation: async () => undefined,
    })),
  );
  const reviewerInstance = "operations-acceptance-reviewer";
  await db.execute("INSERT INTO worker_heartbeats VALUES('dossier-review',?,?,?,?)", [
    reviewerInstance,
    releaseSha,
    fingerprint,
    new Date().toISOString(),
  ]);
  await runMaintenanceTasks(
    db,
    { workerInstance: reviewerInstance, releaseSha, databaseFingerprint: fingerprint },
    [{ task: "host_provider_checks", operation: async () => undefined }],
  );
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
  await associateIncidentWork(db, incident.id, {
    ...work,
    jobId: "operations-terminal-job",
    canonicalJobId: terminalCanonical,
    opportunityVersion: terminalVersion,
  });
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
  await db.execute("DELETE FROM worker_heartbeats WHERE worker_name='evaluation'");
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  const terminalLink = page.getByRole("link", {
    name: /High: evaluation: 1 dead-letter, 0 failed, 0 needs-attention/,
  });
  await terminalLink.waitFor();
  await page
    .getByRole("link", { name: /High: Evaluation maintenance worker unavailable/ })
    .waitFor();
  await page.screenshot({ path: ".radar/acceptance/operations-attention.png", fullPage: true });
  await terminalLink.click();
  await page
    .locator("#queue-evaluation")
    .getByText("operations-terminal-job", { exact: true })
    .waitFor();
  await page
    .locator("#queue-evaluation")
    .getByText("Domain recovery policy required; Operations resume unavailable", { exact: true })
    .waitFor();
  await db.execute("INSERT INTO worker_heartbeats VALUES('evaluation',?,'development',?,?)", [
    instance,
    fingerprint,
    new Date().toISOString(),
  ]);
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await page.getByRole("heading", { name: "Tavily connection", exact: true }).waitFor();
  assert(
    (await page.request.get(`${baseUrl}/health/operations`)).status() === 200,
    "external heartbeat probe unavailable",
  );
  await db.execute(
    "UPDATE operations_maintenance_tasks SET consecutive_failures=1 WHERE worker_instance=? AND task='host_provider_checks'",
    [reviewerInstance],
  );
  assert(
    (await page.request.get(`${baseUrl}/health/operations`)).status() === 503,
    "failed Google maintenance was hidden by healthy evaluation",
  );
  await runMaintenanceTasks(
    db,
    { workerInstance: reviewerInstance, releaseSha, databaseFingerprint: fingerprint },
    [{ task: "host_provider_checks", operation: async () => undefined }],
  );
  assert(
    (await page.request.get(`${baseUrl}/health/operations`)).status() === 200,
    "recovered Google maintenance remained unhealthy",
  );
  await page.getByLabel("Operational change reason").fill("Recover isolated credential incident");
  const affected = page
    .locator(`#incident-${incident.id} details`)
    .filter({ has: page.getByText("Affected work and exclusions", { exact: true }) });
  await affected.getByText("Affected work and exclusions", { exact: true }).click();
  const excluded = affected
    .locator("div")
    .filter({ has: page.getByText(/evaluation.*operations-terminal-job/) })
    .last();
  await excluded
    .getByRole("button", { name: "Exclude from provider recovery", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Operation recorded." }).waitFor();
  assert(
    await db.one(
      "SELECT job_id FROM provider_incident_jobs WHERE job_id='operations-terminal-job' AND accounted_reason='OPERATOR_EXCLUDED'",
    ),
    "exact exclusion missing",
  );
  assert(
    await db.one("SELECT id FROM admin_audit_log WHERE action='recovery.exclude'"),
    "exclusion audit missing",
  );
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
  await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await operation(page, "Activate validated candidate");
  await refreshSearchWorkerReceipt(db);
  await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  await page.getByText("Workers loaded: 1/1", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Select recovery cohort", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await operation(page, "Preview selected work");
  await operation(page, "Resume 1 selected jobs");
  await completeOperationalMemo(db, identity, work.jobId);
  await reconcileProviderIncidents(db);
  const send = async (
    _url: string,
    body: string,
    secret: string,
    deliveryId: string,
    eventId: string,
  ) => {
    assert(secret === signingSecret, "signing secret mismatch");
    assert(JSON.parse(body).eventId === eventId, "event identity missing");
    assert(
      notificationSignature(secret, String(Date.now()), eventId, deliveryId, body).length === 64,
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
  // Document identities render and exclude without inventing opportunity identity.
  await db.execute(
    "INSERT INTO candidate_documents(id,tenant_id,person_id,filename,storage_uri,mime_type,document_hash) VALUES('operations-cv',?,?,'fixture-cv.txt','fixture://operations-cv','text/plain','operations-cv-hash')",
    [identity.tenantId, identity.personId],
  );
  await db.execute(
    "INSERT INTO candidate_document_jobs(id,tenant_id,person_id,document_id,job_hash,payload_json,next_attempt_at) VALUES('operations-document-job',?,?,'operations-cv','operations-document-hash','{}',datetime('now','+1 day'))",
    [identity.tenantId, identity.personId],
  );
  const documentIncident = await observeProviderFailure(db, {
    connectionId: "bedrock:host",
    provider: "bedrock-mantle",
    generation: 0,
    failure: "credential",
    status: 401,
    deployment: fingerprint,
    work: {
      pipeline: "documents",
      jobId: "operations-document-job",
      tenantId: identity.tenantId,
      personId: identity.personId,
      documentId: "operations-cv",
    },
  });
  await page.getByRole("button", { name: "Refresh operations", exact: true }).click();
  const documentAffected = page
    .locator(`#incident-${documentIncident} details`)
    .filter({ has: page.getByText("Affected work and exclusions", { exact: true }) });
  await documentAffected.getByText("Affected work and exclusions", { exact: true }).click();
  await documentAffected
    .getByText(/documents.*operations-document-job.*document operations-cv/)
    .waitFor();
  await page.screenshot({ path: ".radar/acceptance/operations-documents.png", fullPage: true });
  await documentAffected
    .getByRole("button", { name: "Exclude from provider recovery", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Operation recorded." }).waitFor();
  assert(
    await db.one(
      "SELECT job_id FROM provider_incident_jobs WHERE job_id='operations-document-job' AND accounted_reason='OPERATOR_EXCLUDED'",
    ),
    "document exclusion missing",
  );
  assert(
    await db.one(
      "SELECT id FROM candidate_document_jobs WHERE id='operations-document-job' AND status='pending'",
    ),
    "document exclusion changed queue state",
  );
  await context.close();
}
