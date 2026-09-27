
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("editorial composition boundary", () => {
  it("keeps browser dossier rendering outside the legacy composer", () => {
    const route = source("src/routes/opportunity.$jobHash.tsx");
    expect(route).not.toMatch(/BriefCompositionEngine\.compose/);
    expect(route).not.toMatch(/new\s+BriefCompositionEngine/);
  });

  it("keeps the retired deterministic dossier path out of runtime serving", () => {
    for (const path of [
      "src/lib/intelligence/EvaluationWorker.ts",
      "src/lib/intelligence/context-materialization.ts",
      "src/routes/opportunity.$jobHash.tsx",
    ]) {
      expect(source(path)).not.toMatch(/dossier-v2|DossierPresentationV2|CanonicalDossierV2/);
    }
  });
});
