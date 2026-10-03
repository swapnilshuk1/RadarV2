import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  releasePayloadChecksum,
  runtimeInputChecksum,
  runtimeScriptIncluded,
  runtimeNpmScript,
  productionDependencyFilter,
} from "./payload";
export { releasePayloadChecksum } from "./payload";

export type ReleaseManifest = {
  readonly sourceTree?: string;
  readonly runtimeInputSha256?: string;
  readonly commitSha: string;
  readonly builtAt: string;
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly packageLockSha256: string;
  readonly certificationManifestSha256: string;
  readonly payloadSha256: string;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

function command(command: string, args: string[]): string {
  const executable =
    process.platform === "win32"
      ? command === "git"
        ? "git.exe"
        : command === "npm"
          ? "npm.cmd"
          : command
      : command;
  if (process.platform === "win32") {
    return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", executable, ...args], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  }
  return execFileSync(executable, args, { cwd: root, encoding: "utf8" }).trim();
}

export function createReleaseBundle(outputDirectory = path.join(root, "release")): {
  artifactPath: string;
  manifest: ReleaseManifest;
} {
  const commitSha = command("git", ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("RELEASE_SHA_INVALID");
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "radar-release-"));
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const dependencies = productionDependencyFilter(lock, root);
    for (const entry of [
      ".output",
      "src",
      "scripts",
      "config",
      "tsconfig.json",
      "ecosystem.config.cjs",
      "package.json",
      "package-lock.json",
      "node_modules",
    ]) {
      const source = fs.realpathSync(path.join(root, entry));
      if (!fs.existsSync(source)) throw new Error(`RELEASE_PAYLOAD_MISSING: ${entry}`);
      fs.cpSync(source, path.join(staging, entry), {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
        filter: (absolute) => {
          const logical = path.join(root, entry, path.relative(source, absolute));
          const relative = path.relative(root, logical).replaceAll("\\", "/");
          if (entry === "node_modules") return dependencies(logical);
          if (entry === "scripts")
            return fs.lstatSync(absolute).isDirectory() || runtimeScriptIncluded(relative);
          return true;
        },
      });
    }
    // Preserve certification provenance as metadata without shipping its executable scripts.
    fs.mkdirSync(path.join(staging, "release-metadata"), { recursive: true });
    fs.copyFileSync(
      path.join(root, "scripts/certification/registry.ts"),
      path.join(staging, "release-metadata/test-registry.ts"),
    );
    const pkg = JSON.parse(fs.readFileSync(path.join(staging, "package.json"), "utf8"));
    pkg.scripts = Object.fromEntries(
      Object.entries(pkg.scripts).filter(([name]) => runtimeNpmScript(name)),
    );
    delete pkg.devDependencies;
    fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    const manifest: ReleaseManifest = {
      commitSha,
      sourceTree: command("git", ["show", "-s", "--format=%T", "HEAD"]),
      runtimeInputSha256: runtimeInputChecksum(root),
      builtAt: new Date().toISOString(),
      nodeVersion: process.version,
      npmVersion: command("npm", ["--version"]),
      packageLockSha256: sha256(fs.readFileSync(path.join(root, "package-lock.json"))),
      certificationManifestSha256: sha256(
        fs.readFileSync(path.join(staging, "release-metadata/test-registry.ts")),
      ),
      payloadSha256: releasePayloadChecksum(staging),
    };
    fs.writeFileSync(
      path.join(staging, "release-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    fs.mkdirSync(outputDirectory, { recursive: true });
    const artifactPath = path.join(outputDirectory, `radar-release-${commitSha}.tar.gz`);
    execFileSync(
      process.platform === "win32" ? "tar.exe" : "tar",
      ["-czf", artifactPath, "-C", staging, "."],
      { stdio: "inherit" },
    );
    fs.writeFileSync(
      artifactPath + ".sha256",
      `${sha256(fs.readFileSync(artifactPath))}  ${path.basename(artifactPath)}\n`,
    );
    return { artifactPath, manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("package.ts") || process.argv[1]?.endsWith("package.js")) {
  const result = createReleaseBundle();
  console.log(JSON.stringify(result));
}
