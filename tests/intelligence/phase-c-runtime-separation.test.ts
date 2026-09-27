import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelInvalidOutputError,
  ModelProviderUnavailableError,
  classifyModelFailure,
} from "../../src/lib/model/provider-unavailable";

const root = path.resolve(__dirname, "../..");
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Phase C runtime separation", () => {
  it("keeps worker loops out of web server actions", () => {
    const scrapeServer = source("src/lib/intelligence/scrape-server.ts");
    const evaluationServer = source("src/lib/intelligence/evaluation-server.ts");
    expect(scrapeServer).not.toContain('import("../../../scripts/scrape")');
    expect(scrapeServer).not.toContain("runCorpusPipeline");
    expect(evaluationServer).not.toContain("startGlobalDaemon");
  });

  it("has explicit, signal-aware scraper and evaluator worker entrypoints", () => {
    const scraper = source("scripts/run-scrape-worker.ts");
    const evaluator = source("scripts/run-evaluation-worker.ts");
    expect(scraper).toContain("process.once(\"SIGTERM\"");
    expect(scraper).toContain("while (!stopping)");
    expect(scraper).toContain("tenant_id");
    expect(scraper).toContain("person_id");
    expect(scraper).toContain("portal_targets");
    expect(scraper).toContain("config_json");
    expect(scraper).toContain("portals: portals.length ? portals : undefined");
    expect(source("scripts/scrape.ts")).toContain("opts.scope?.tenantId || opts.authContext?.tenantId");
    expect(evaluator).toContain("process.once(\"SIGTERM\"");
    expect(evaluator).toContain("daemon.start()");
  });

  it("classifies operational and invalid-output model failures differently", () => {
    expect(classifyModelFailure(new ModelProviderUnavailableError("limited", 429)).code).toBe("MODEL_THROTTLED");
    expect(classifyModelFailure(new ModelProviderUnavailableError("bad credential", 401)).code).toBe("MODEL_CREDENTIAL");
    const invalid = classifyModelFailure(new ModelInvalidOutputError("invalid json"));
    expect(invalid.code).toBe("MODEL_INVALID_OUTPUT");
    expect(invalid.transient).toBe(false);
  });

  it("does not serve an unreviewed dossier draft as canonical prose", () => {
    expect(source("src/data/sqlite/repositories/SqliteOpportunityQueries.ts")).toContain("const dossier = reviewed;");
    expect(source("src/lib/intelligence/staged/StagedServingPublisher.ts")).toContain("const dossier = reviewed;");
  });
});
