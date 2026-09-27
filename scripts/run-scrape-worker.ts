/**
 * Explicit scraper-worker entrypoint. The web process only creates queued,
 * tenant/person-owned scrape runs; this process is the sole Playwright owner.
 */
import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { startRun } from "./scrape";
import type { PortalName } from "./scraper/types";

let stopping = false;
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

async function claimAndRun(): Promise<boolean> {
  const db = getDatabaseAdapter();
  const row = await db.one<{
    id: string;
    tenant_id: string;
    person_id: string;
    search_plan_id: string | null;
    portal_targets: string;
    config_json: string;
  }>(
    `SELECT id,tenant_id,person_id,search_plan_id,portal_targets,config_json
     FROM scrape_runs WHERE status='queued' ORDER BY created_at LIMIT 1`,
  );
  if (!row) return false;
  const scope = { tenantId: row.tenant_id, personId: row.person_id };
  const repos = getRepositories();
  const claimed = await repos.scrapeRuns.transitionRunStatus(scope, row.id, 'queued', 'initializing');
  if (!claimed) return true;
  const claimedRun = await repos.scrapeRuns.getRun(scope, row.id);
  if (claimedRun?.status !== 'initializing') {
    throw new Error(`SCRAPE_WORKER_CLAIM_NOT_VISIBLE: durable status=${claimedRun?.status ?? 'missing'}`);
  }
  try {
    // The durable run was authorized before enqueue. This worker consumes its
    // immutable tenant/person command and never fabricates an AuthContext.
    let config: Record<string, unknown> = {};
    let portals: PortalName[] = [];
    try { config = JSON.parse(row.config_json || "{}"); } catch {}
    try {
      const requested = JSON.parse(row.portal_targets || "[]");
      if (Array.isArray(requested)) {
        portals = requested.filter((value): value is PortalName =>
          value === "LinkedIn" || value === "Naukri" || value === "Indeed"
        );
      }
    } catch {}
    const { completion } = await startRun({
      resume: true,
      autoConfirm: true,
      scope,
      searchPlanId: row.search_plan_id ?? undefined,
      portals: portals.length ? portals : undefined,
      maxPages: typeof config.maxPages === "number" ? config.maxPages : undefined,
      maxCardsPerPage: typeof config.maxCardsPerPage === "number" ? config.maxCardsPerPage : undefined,
      keywords: Array.isArray(config.keywords) && config.keywords.every((value) => typeof value === "string")
        ? config.keywords as string[]
        : undefined,
    });
    await completion;
  } catch (error) {
    await repos.scrapeRuns.updateRunStatus(scope, row.id, "failed", error instanceof Error ? error.message : "SCRAPE_WORKER_FAILED");
  }
  return true;
}

async function run() {
  while (!stopping) {
    const claimed = await claimAndRun();
    if (!claimed) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
void run();
