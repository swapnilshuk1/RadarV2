import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseManifest = {
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

export function releasePayloadChecksum(directory: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "release-manifest.json") continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).replaceAll("\\", "/");
      hash.update(`${entry.isDirectory() ? "d" : "f"}:${relative}\0`);
      if (entry.isDirectory()) visit(absolute);
      else hash.update(fs.readFileSync(absolute));
    }
  };
  visit(directory);
  return hash.digest("hex");
}

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
    for (const entry of [
      ".output",
      "src",
      "scripts",
      "ecosystem.config.cjs",
      "package.json",
      "package-lock.json",
      "node_modules",
    ]) {
      const source = path.join(root, entry);
      if (!fs.existsSync(source)) throw new Error(`RELEASE_PAYLOAD_MISSING: ${entry}`);
      fs.cpSync(source, path.join(staging, entry), { recursive: true, force: true });
    }
    const manifest: ReleaseManifest = {
      commitSha,
      builtAt: new Date().toISOString(),
      nodeVersion: process.version,
      npmVersion: command("npm", ["--version"]),
      packageLockSha256: sha256(fs.readFileSync(path.join(root, "package-lock.json"))),
      certificationManifestSha256: sha256(
        fs.readFileSync(path.join(root, "scripts/certification/manifest.ts")),
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
    return { artifactPath, manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("package.ts") || process.argv[1]?.endsWith("package.js")) {
  const result = createReleaseBundle();
  console.log(JSON.stringify(result));
}
