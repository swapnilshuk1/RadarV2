/**
 * Fast local feedback only. This command is deliberately non-authoritative:
 * npm run certify remains the only release-certification command.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { certificationManifest, certificationTestFiles } from "./manifest";
import { sourceOwnership } from "./registry";

const require = createRequire(import.meta.url);

type CertificationGroupId = (typeof certificationManifest)[number]["id"];

const allGroupIds = certificationManifest.map((group) => group.id);

function groupsForKnownSource(file: string): CertificationGroupId[] | null {
  const ownership = sourceOwnership.find((rule) => rule.pattern.test(file));
  if (!ownership) return null;
  return ownership.groups === "all" ? allGroupIds : [...ownership.groups];
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
  const explicitBase =
    baseIndex >= 0 ? process.argv[baseIndex + 1] : process.env.CERTIFY_AFFECTED_BASE;
  const diffTarget = explicitBase ? `${explicitBase}...HEAD` : "HEAD";
  const tracked = gitLines(["diff", "--name-only", "--diff-filter=ACMRD", diffTarget]);
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

  if (files.length === 0) return;

  // Vitest 4 exposes its executable through package metadata rather than an
  // exported subpath. Resolve the installed package, then invoke that CLI
  // directly with Node to avoid Windows' npx.cmd spawn semantics.
  const vitestCli = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  execFileSync(
    process.execPath,
    [vitestCli, "run", "--config", "vitest.certification.config.ts", ...files],
    {
      stdio: "inherit",
    },
  );
}

if (process.argv[1]?.endsWith("affected.ts") || process.argv[1]?.endsWith("affected.js")) {
  runAffectedCertification();
}
