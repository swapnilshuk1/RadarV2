/**
 * scripts/certify.ts
 *
 * RADAR v2 — Single Authoritative Continuous Certification Gate
 *
 * Executes all critical contracts, security isolations, serving invariants,
 * boundary journeys, and production builds in a deterministic sequence.
 *
 * Invariants:
 * 1. Fails immediately on any compilation, test, or build failure.
 * 2. Emits unambiguous CERTIFICATION PASS or CERTIFICATION FAIL status.
 * 3. Independent of nondeterministic external portal availability.
 */

import { execSync } from "child_process";

export interface Stage {
  name: string;
  command: string;
  description: string;
}

export const STAGES: Stage[] = [
  {
    name: "Stage 1: TypeScript Static Verification",
    command: "npx tsc --noEmit",
    description: "Strict compile-time type agreement across domain and UI layers",
  },
  {
    name: "Stage 2: Four Boundary Journeys (A, B, C, D)",
    command: "npx vitest run tests/certification/",
    description: "End-to-end integration across acquisition, semantic policy, decision persistence, and UI rendering",
  },
  {
    name: "Stage 3: Canonical Ingestion & Lineage Contracts",
    command: "npx vitest run tests/intelligence/canonical-ingestion-fk-regression.test.ts tests/intelligence/canonical-acquisition-integrity.test.ts tests/intelligence/canonical-identity.test.ts tests/intelligence/semantic-evidence-integrity-regression.test.ts tests/intelligence/metrics-portal-breakdown.test.ts",
    description: "FK integrity, content hashing, version lineage, and global metric aggregations",
  },
  {
    name: "Stage 4: Multi-Tenant & Scope Security Isolation",
    command: "npx vitest run tests/security/scope-resolver-equivalence.test.ts tests/security/deploy-attack-surface-removed.test.ts tests/ontology/tenant-ontology-compiler.test.ts",
    description: "Strict tenant isolation, credential broker boundaries, and scope resolution",
  },
  {
    name: "Stage 5: Serving Store & Keyset Pagination Invariants",
    command: "npx vitest run tests/serving/",
    description: "Feed ordering parity, opaque cursor stability, dossier navigation, and singleflight coalescing",
  },
  {
    name: "Stage 6: Editorial Governance & Verdict Contracts",
    command: "npx vitest run tests/editorial/",
    description: "Rule 13 executive prose compliance, score resolution, and badge mappings",
  },
  {
    name: "Stage 7: Production SSR Bundle Build",
    command: "npm run build",
    description: "Nitro server and Vite client bundling for cloud deployment",
  },
];

export function runCertification(stages: Stage[] = STAGES) {
  console.log("\n============================================================");
  console.log("     RADAR v2 — CONTINUOUS CERTIFICATION GATE");
  console.log("============================================================\n");

  const startTime = Date.now();
  let completedStages = 0;

  for (const stage of stages) {
    console.log(`\n▶ [${completedStages + 1}/${stages.length}] ${stage.name}`);
    console.log(`  Target: ${stage.description}`);
    console.log(`  Command: ${stage.command}\n`);

    const stageStart = Date.now();
    try {
      execSync(stage.command, { stdio: "inherit", env: process.env });
      const elapsed = ((Date.now() - stageStart) / 1000).toFixed(2);
      console.log(`✔ ${stage.name} passed (${elapsed}s)`);
      completedStages++;
    } catch (err: any) {
      const elapsed = ((Date.now() - stageStart) / 1000).toFixed(2);
      console.error(`\n❌ ${stage.name} FAILED after ${elapsed}s`);
      console.error(`\n============================================================`);
      console.error(`              ❌ CERTIFICATION FAIL`);
      console.error(`============================================================`);
      console.error(`Failed Stage: ${stage.name}`);
      console.error(`Command: ${stage.command}`);
      process.exit(1);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n============================================================");
  console.log("              ✅ CERTIFICATION PASS");
  console.log("============================================================");
  console.log(`All ${stages.length} certification stages passed cleanly in ${totalElapsed}s.`);
  console.log("Deterministic certification gate passed; production deployment remains subject to post-deployment smoke verification.\n");
}

if (process.argv[1]?.endsWith("certify.ts") || process.argv[1]?.endsWith("certify.js")) {
  runCertification();
}
