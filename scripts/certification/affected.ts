/**
 * Fast local feedback only. This command is deliberately non-authoritative:
 * npm run certify remains the only release-certification command.
 */

import { execFileSync } from "node:child_process";
import { certificationManifest, certificationTestFiles } from "./manifest";

type CertificationGroupId = (typeof certificationManifest)[number]["id"];

const allGroupIds = certificationManifest.map((group) => group.id);

function groupsForKnownSource(file: string): CertificationGroupId[] | null {
  if (
    file === "package.json" ||
    file === "package-lock.json" ||
    file.startsWith("tsconfig") ||
    file.startsWith("vitest") ||
    file.startsWith("scripts/certification/")
  ) return allGroupIds;

  if (file.startsWith("src/lib/security/") || file.startsWith("src/lib/auth/") || file.startsWith("scripts/scraper/")) {
    return ["boundary-journeys", "tenant-security"];
  }

  if (file.startsWith("src/lib/intelligence/editorial/") || file.startsWith("src/components/radar/opportunity/")) {
    return ["boundary-journeys", "editorial-governance"];
  }

  if (
    file.startsWith("src/lib/acquisition/") ||
    file.startsWith("src/lib/intelligence/extraction/") ||
    file.startsWith("src/lib/intelligence/semantic/")
  ) return ["boundary-journeys", "ingestion-lineage"];

  if (
    file.startsWith("src/data/") ||
    file.startsWith("src/routes/") ||
    file.startsWith("src/lib/intelligence/serving/") ||
    file.includes("opportunity-service") ||
    file.includes("opportunity-queries")
  ) return ["boundary-journeys", "serving-pagination"];

  return null;
}

/** Returns every group when a change cannot be mapped with confidence. */
export function selectAffectedGroupIds(changedFiles: readonly string[]): CertificationGroupId[] {
  if (changedFiles.length === 0) return allGroupIds;

  const selected = new Set<CertificationGroupId>();
  for (const file of changedFiles) {
    const testGroup = certificationManifest.find((group) => group.files.includes(file as never));
    const groups = testGroup ? [testGroup.id] : groupsForKnownSource(file);
    if (!groups) return allGroupIds;
    for (const group of groups) selected.add(group);
  }

  return allGroupIds.filter((id) => selected.has(id));
}

export function filesForAffectedGroups(groupIds: readonly CertificationGroupId[]): string[] {
  return certificationManifest
    .filter((group) => groupIds.includes(group.id))
    .flatMap((group) => group.files);
}

function gitLines(args: string[]): string[] {
  const executable = process.platform === "win32" ? "git.exe" : "git";
  return execFileSync(executable, args, { encoding: "utf-8" }).split(/\r?\n/).filter(Boolean);
}

function changedFilesFromGit(): string[] {
  const baseIndex = process.argv.indexOf("--base");
  const explicitBase = baseIndex >= 0 ? process.argv[baseIndex + 1] : process.env.CERTIFY_AFFECTED_BASE;
  const diffTarget = explicitBase ? `${explicitBase}...HEAD` : "HEAD";
  const tracked = gitLines(["diff", "--name-only", "--diff-filter=ACMR", diffTarget]);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].sort();
}

function runAffectedCertification() {
  const changedFiles = changedFilesFromGit();
  const groups = selectAffectedGroupIds(changedFiles);
  const files = filesForAffectedGroups(groups);

  console.log("\nRADAR affected-test feedback (non-authoritative)");
  console.log(`Changed files: ${changedFiles.length || "none detected; using the full manifest"}`);
  console.log(`Logical groups: ${groups.join(", ")}`);
  console.log(`Tests selected: ${files.length}/${certificationTestFiles.length}\n`);

  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(executable, ["vitest", "run", "--config", "vitest.certification.config.ts", ...files], {
    stdio: "inherit",
  });
}

if (process.argv[1]?.endsWith("affected.ts") || process.argv[1]?.endsWith("affected.js")) {
  runAffectedCertification();
}
