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
import { certificationManifest } from "./certification/manifest";

export interface Stage {
  name: string;
  command: string;
  description: string;
  execution?: "command" | "manifest" | "reported-by-manifest";
}

export const STAGES: Stage[] = [
  {
    name: "Stage 1: TypeScript Static Verification",
    command: "npx tsc -p tsconfig.verify.json --noEmit",
    description: "Strict compile-time type agreement across domain and UI layers",
  },
  {
    name: "Stage 2: Four Boundary Journeys (A, B, C, D)",
    command: "npx vitest run --config vitest.certification.config.ts",
    description: "End-to-end integration across acquisition, semantic policy, decision persistence, and UI rendering",
    execution: "manifest",
  },
  {
    name: "Stage 3: Canonical Ingestion & Lineage Contracts",
    command: "Unified Vitest certification manifest (executed once in Stage 2)",
    description: "FK integrity, content hashing, version lineage, and global metric aggregations",
    execution: "reported-by-manifest",
  },
  {
    name: "Stage 4: Multi-Tenant & Scope Security Isolation",
    command: "Unified Vitest certification manifest (executed once in Stage 2)",
    description: "Strict tenant isolation, credential broker boundaries, and scope resolution",
    execution: "reported-by-manifest",
  },
  {
    name: "Stage 5: Serving Store & Keyset Pagination Invariants",
    command: "Unified Vitest certification manifest (executed once in Stage 2)",
    description: "Feed ordering parity, opaque cursor stability, dossier navigation, and singleflight coalescing",
    execution: "reported-by-manifest",
  },
  {
    name: "Stage 6: Editorial Governance & Verdict Contracts",
    command: "Unified Vitest certification manifest (executed once in Stage 2)",
    description: "Rule 13 executive prose compliance, score resolution, and badge mappings",
    execution: "reported-by-manifest",
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
  const profile = process.argv.includes("--profile");
  const verboseTestProfile = process.env.CERTIFY_PROFILE_VERBOSE === "1";
  let manifestCompleted = false;

  if (profile) {
    console.log("Profile mode enabled: TypeScript diagnostics and stage timings will be emitted.\n");
  }

  for (const stage of stages) {
    console.log(`\n▶ [${completedStages + 1}/${stages.length}] ${stage.name}`);
    console.log(`  Target: ${stage.description}`);
    console.log(`  Command: ${stage.command}\n`);

    const stageStart = Date.now();
    try {
      if (stage.execution === "reported-by-manifest") {
        if (!manifestCompleted) {
          throw new Error("The unified certification manifest did not complete before logical group reporting.");
        }
        console.log("  Verified by the single Stage 2 Vitest invocation.");
      } else {
        const command = profile && stage.name.includes("TypeScript")
          ? `${stage.command} --extendedDiagnostics`
          : verboseTestProfile && stage.execution === "manifest"
            ? `${stage.command} --reporter=verbose`
            : stage.command;
        execSync(command, { stdio: "inherit", env: process.env });
        if (stage.execution === "manifest") {
          manifestCompleted = true;
          console.log(`  Unified manifest verified ${certificationManifest.length} logical groups in one Vitest process.`);
        }
      }
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
