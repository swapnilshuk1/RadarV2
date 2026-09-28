import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releasePayloadChecksum } from "../../scripts/release/package";
import { verifyReleaseDirectory } from "../../scripts/release/verify";

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

describe("certified release artifacts", () => {
  const directories: string[] = [];
  afterEach(() =>
    directories
      .splice(0)
      .forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })),
  );

  function releaseDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-artifact-"));
    directories.push(directory);
    fs.mkdirSync(path.join(directory, "scripts/certification"), { recursive: true });
    fs.writeFileSync(path.join(directory, "package-lock.json"), '{"lockfileVersion":3}\n');
    fs.writeFileSync(
      path.join(directory, "scripts/certification/manifest.ts"),
      "export const manifest = [];\n",
    );
    fs.writeFileSync(path.join(directory, "payload.txt"), "certified\n");
    const manifest = {
      commitSha: "a".repeat(40),
      builtAt: "2026-01-01T00:00:00.000Z",
      nodeVersion: "v22.12.0",
      npmVersion: "10.9.8",
      packageLockSha256: digest(fs.readFileSync(path.join(directory, "package-lock.json"), "utf8")),
      certificationManifestSha256: digest(
        fs.readFileSync(path.join(directory, "scripts/certification/manifest.ts"), "utf8"),
      ),
      payloadSha256: releasePayloadChecksum(directory),
    };
    fs.writeFileSync(path.join(directory, "release-manifest.json"), JSON.stringify(manifest));
    return directory;
  }

  it("accepts only an artifact whose SHA and payload checksums match", () => {
    const directory = releaseDirectory();
    expect(verifyReleaseDirectory(directory, "a".repeat(40)).commitSha).toBe("a".repeat(40));
    fs.writeFileSync(path.join(directory, "payload.txt"), "tampered\n");
    expect(() => verifyReleaseDirectory(directory, "a".repeat(40))).toThrow(
      /RELEASE_PAYLOAD_CHECKSUM_MISMATCH/,
    );
  });

  it("binds a symbolic link's target instead of its dereferenced payload", () => {
    const directory = releaseDirectory();
    const link = path.join(directory, "runtime-link");
    try {
      fs.symlinkSync("payload.txt", link);
    } catch (error) {
      if (process.platform === "win32") return;
      throw error;
    }

    const checksum = releasePayloadChecksum(directory);
    fs.unlinkSync(link);
    fs.symlinkSync("scripts/certification/manifest.ts", link);

    expect(releasePayloadChecksum(directory)).not.toBe(checksum);
  });
});
