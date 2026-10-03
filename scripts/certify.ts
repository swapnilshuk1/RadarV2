/**
 * scripts/certify.ts
 *
 * RADAR v2 — Single Authoritative Continuous Certification Gate
 *
 * Executes all critical contracts, security isolations, serving invariants,
 * boundary journeys, and production builds in a deterministic sequence.
 *
 * Invariants:
 * 1. Collects independent stage failures and exits nonzero after all diagnostics.
 * 2. Emits unambiguous CERTIFICATION PASS or CERTIFICATION FAIL status.
 * 3. Independent of nondeterministic external portal availability.
 */

import { execSync } from "child_process";
import { appendFileSync } from "node:fs";
import { certificationManifest } from "./certification/manifest";

export interface Stage {
  name: string;
  command: string;
  description: string;
  execution?: "command" | "manifest" | "reported-by-manifest";
  requiresToolchain?: boolean;
}

export const STAGES: Stage[] = [
  {
    name: "Stage 0: Lint",
    command: "npm run lint",
    description: "Active release paths must satisfy the repository lint contract",
  },
  {
    name: "Stage 0.1: Formatting",
    command: "npm run format:check",
    description: "Release certification is non-mutating and format-clean",
  },
  {
    name: "Stage 1: TypeScript Static Verification",
    command: "npx tsc -p tsconfig.verify.json --noEmit",
    description: "Strict compile-time type agreement across domain and UI layers",
  },
  {
    name: "Stage 2: Production SSR Bundle Build",
    requiresToolchain: true,
    command: "npm run build",
    description: "Nitro server and Vite client bundling required by deployment invariants",
  },
  {
    name: "Stage 3: Four Boundary Journeys (A, B, C, D)",
    command: "npx vitest run --config vitest.certification.config.ts",
    description:
      "End-to-end integration across acquisition, semantic policy, decision persistence, and UI rendering",
    execution: "manifest",
    requiresToolchain: true,
  },
];

export const FEEDBACK_STAGES: Stage[] = [
  ...STAGES.slice(0, 3),
  {
    name: "Affected regression tests",
    requiresToolchain: true,
    command: "npm run certify:affected",
    description: "Changed-file regression feedback; main certification remains authoritative",
  },
];

export function runCertification(stages: Stage[] = STAGES, authoritative = true) {
  const label = authoritative ? "CERTIFICATION" : "FEEDBACK";
  console.log("\n============================================================");
  console.log(`     RADAR v2 — ${label}`);
  console.log("============================================================\n");

  const startTime = Date.now();
  let completedStages = 0;
  const profile = process.argv.includes("--profile");
  const verboseTestProfile = process.env.CERTIFY_PROFILE_VERBOSE === "1";
  let manifestCompleted = false;
  const failures: Stage[] = [];
  const blocked: Stage[] = [];
  const outcomes: Array<{ name: string; status: string; seconds: string }> = [];
  const baseIndex = process.argv.indexOf("--base");
  const affectedBase =
    baseIndex >= 0 ? process.argv[baseIndex + 1] : process.env.CERTIFY_AFFECTED_BASE;

  if (profile) {
    console.log(
      "Profile mode enabled: TypeScript diagnostics and stage timings will be emitted.\n",
    );
  }

  for (const [index, stage] of stages.entries()) {
    console.log(`\n▶ [${index + 1}/${stages.length}] ${stage.name}`);
    console.log(`  Target: ${stage.description}`);
    console.log(`  Command: ${stage.command}\n`);

    if (stage.requiresToolchain && failures.length > 0) {
      blocked.push(stage);
      outcomes.push({
        name: stage.name,
        status: "skipped (static checks failed)",
        seconds: "0.00",
      });
      console.error(`Skipped ${stage.name}: static checks must pass before build/tests.`);
      continue;
    }
    const stageStart = Date.now();
    try {
      if (stage.execution === "reported-by-manifest") {
        if (!manifestCompleted) {
          blocked.push(stage);
          outcomes.push({ name: stage.name, status: "skipped (manifest failed)", seconds: "0.00" });
          console.error(`Skipped ${stage.name}: requires a successful unified manifest.`);
          continue;
        }
        console.log("  Verified by the single Stage 3 Vitest invocation.");
      } else {
        const command =
          profile && stage.name.includes("TypeScript")
            ? `${stage.command} --extendedDiagnostics`
            : verboseTestProfile && stage.execution === "manifest"
              ? `${stage.command} --reporter=verbose`
              : stage.command;
        execSync(command, {
          stdio: "inherit",
          env: { ...process.env, ...(affectedBase ? { CERTIFY_AFFECTED_BASE: affectedBase } : {}) },
        });
        if (stage.execution === "manifest") {
          manifestCompleted = true;
          console.log(
            `  Unified manifest verified ${certificationManifest.length} logical groups in one Vitest process.`,
          );
        }
      }
      const elapsed = ((Date.now() - stageStart) / 1000).toFixed(2);
      outcomes.push({ name: stage.name, status: "passed", seconds: elapsed });
      console.log(`✔ ${stage.name} passed (${elapsed}s)`);
      completedStages++;
    } catch {
      failures.push(stage);
      const elapsed = ((Date.now() - stageStart) / 1000).toFixed(2);
      outcomes.push({ name: stage.name, status: "failed", seconds: elapsed });
      console.error(`\n❌ ${stage.name} FAILED after ${elapsed}s`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escapeCell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
    const summary = [
      `## ${label}: ${failures.length || blocked.length ? "FAIL" : "PASS"}`,
      `Elapsed: ${totalElapsed}s. ${authoritative ? "Authoritative release checks." : "PR feedback only; no release artifact."}`,
      "",
      "| Check | Result | Seconds |",
      "| --- | --- | ---: |",
      ...outcomes.map(
        (result) => `| ${escapeCell(result.name)} | ${result.status} | ${result.seconds} |`,
      ),
      "",
    ].join("\n");
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    } catch {
      console.warn("CHECK_SUMMARY_WRITE_UNAVAILABLE");
    }
  }
  if (failures.length || blocked.length) {
    console.error(`\n❌ ${label} FAIL (${totalElapsed}s)`);
    console.error(
      `Passed: ${completedStages}; failed: ${failures.length}; dependent groups skipped: ${blocked.length}`,
    );
    for (const stage of failures)
      console.error(`Failed Stage: ${stage.name}\nCommand: ${stage.command}`);
    process.exit(1);
  }
  console.log("\n============================================================");
  console.log(`              ✅ ${label} PASS`);
  console.log("============================================================");
  console.log(
    `All ${stages.length} ${label.toLowerCase()} stages passed cleanly in ${totalElapsed}s.`,
  );
  console.log(
    authoritative
      ? "Deterministic certification gate passed; production deployment remains subject to post-deployment smoke verification.\n"
      : "Developer feedback passed; this does not certify or package a release.\n",
  );
}

if (process.argv[1]?.endsWith("certify.ts") || process.argv[1]?.endsWith("certify.js")) {
  const feedback = process.argv.includes("--feedback");
  runCertification(feedback ? FEEDBACK_STAGES : STAGES, !feedback);
}
