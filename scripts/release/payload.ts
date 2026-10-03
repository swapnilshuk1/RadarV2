import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Keep acquisition and worker capabilities; omit local verification/dev entry points. */
export function runtimeScriptIncluded(relative: string): boolean {
  if (!relative.startsWith("scripts/")) return false;
  if (/^scripts\/(acceptance|certification|dossier|db)\//.test(relative)) return false;
  return (
    !/^scripts\/(dev|certify|qa-eval)\.ts$/.test(relative) &&
    !relative.endsWith(".md") &&
    !/^scripts\/release\/(package|runtime-input)\.ts$/.test(relative)
  );
}

export function runtimeInputIncluded(relative: string): boolean {
  return (
    /^(src\/|config\/)/.test(relative) ||
    runtimeScriptIncluded(relative) ||
    /^(ecosystem\.config\.cjs|vite\.config\.ts|tsconfig.*\.json|package(-lock)?\.json)$/.test(
      relative,
    )
  );
}

/** Content of runtime/build inputs, independent of commit history, docs and test registry. */
export function runtimeInputChecksum(root: string, ref = "HEAD"): string {
  const listing = execFileSync("git", ["ls-tree", "-rz", ref], { cwd: root, encoding: "utf8" });
  const hash = crypto.createHash("sha256");
  for (const item of listing.split("\0").filter(Boolean).sort()) {
    const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(item);
    if (!match || !runtimeInputIncluded(match[3])) continue;
    if (match[3] === "package.json") {
      const pkg = JSON.parse(
        execFileSync("git", ["show", `${ref}:package.json`], { cwd: root, encoding: "utf8" }),
      );
      const scripts = Object.fromEntries(
        Object.entries(pkg.scripts ?? {}).filter(([name]) => runtimeNpmScript(name)),
      );
      hash.update(
        `package.json\0${JSON.stringify({ type: pkg.type, engines: pkg.engines, dependencies: pkg.dependencies, scripts })}\0`,
      );
    } else hash.update(`${match[1]}:${match[3]}:${match[2]}\0`);
  }
  return hash.digest("hex");
}

export function runtimeNpmScript(name: string): boolean {
  return /^(worker:|db:migrate$|db:status$|smoke$|scrape(:preflight)?$|enrich$|corpus:|reconcile:|storage:|diagnose$|repair:|deploy$)/.test(
    name,
  );
}

export function releasePayloadChecksum(directory: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "release-manifest.json") continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).replaceAll("\\", "/");
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        hash.update(`l:${relative}\0`);
        hash.update(fs.readlinkSync(absolute));
      } else if (stat.isDirectory()) {
        hash.update(`d:${relative}\0`);
        visit(absolute);
      } else {
        hash.update(`f:${relative}\0`);
        hash.update(fs.readFileSync(absolute));
      }
    }
  };
  visit(directory);
  return hash.digest("hex");
}

export function productionDependencyFilter(
  lock: { packages: Record<string, { dev?: boolean }> },
  root: string,
) {
  const packages = Object.entries(lock.packages)
    .filter(([file]) => file.startsWith("node_modules/"))
    .sort(([a], [b]) => b.length - a.length);
  const included = Object.entries(lock.packages)
    .filter(([file, pkg]) => file.startsWith("node_modules/") && !pkg.dev)
    .map(([file]) => file);
  return (absolute: string): boolean => {
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    if (!relative || relative === "node_modules") return true;
    if (relative.startsWith("node_modules/.bin")) {
      if (relative === "node_modules/.bin") return true;
      // Linux shims are links into package directories. Keep only production binaries.
      if (!fs.lstatSync(absolute).isSymbolicLink()) return false;
      const target = path
        .relative(root, path.resolve(path.dirname(absolute), fs.readlinkSync(absolute)))
        .replaceAll("\\", "/");
      return included.some((file) => target === file || target.startsWith(file + "/"));
    }
    const containing = packages.find(
      ([file]) => relative === file || relative.startsWith(file + "/"),
    );
    if (containing) return !containing[1].dev;
    return included.some((file) => file.startsWith(relative + "/"));
  };
}
