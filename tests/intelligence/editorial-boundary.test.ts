
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

  it("keeps the V2 materializer independent of legacy narrative and evaluation engines", () => {
    const materializer = source("src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer.ts");
    expect(materializer).not.toMatch(/BriefCompositionEngine/);
    expect(materializer).not.toMatch(/ExecutionEngine/);
    expect(materializer).not.toMatch(/AdvisoryConstitution/);
    expect(materializer).not.toMatch(/CapabilityAssessmentEngine/);
    expect(materializer).toMatch(/composeEditorialIntelligenceV2/);
  });

  it("uses V2 materialization on both current canonical materialization paths", () => {
    const worker = source("src/lib/intelligence/EvaluationWorker.ts");
    const contextMaterialization = source("src/lib/intelligence/context-materialization.ts");
    for (const implementation of [worker, contextMaterialization]) {
      expect(implementation).toMatch(/buildEvaluatedPresentationV2/);
      expect(implementation).toMatch(/buildUnavailablePresentationV2/);
      expect(implementation).not.toMatch(/buildCanonicalDossierPresentation\s*\(/);
    }
  });
});
