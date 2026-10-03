import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ReleaseManifest } from "./package";
import { releasePayloadChecksum } from "./payload";

const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

export function verifyReleaseDirectory(directory: string, expectedSha?: string): ReleaseManifest {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "release-manifest.json"), "utf8"),
  ) as ReleaseManifest;
  if (
    !/^[0-9a-f]{40}$/i.test(manifest.commitSha) ||
    (expectedSha && manifest.commitSha !== expectedSha)
  )
    throw new Error("RELEASE_MANIFEST_SHA_MISMATCH");
  if (manifest.payloadSha256 !== releasePayloadChecksum(directory))
    throw new Error("RELEASE_PAYLOAD_CHECKSUM_MISMATCH");
  if (
    manifest.packageLockSha256 !==
    sha256(fs.readFileSync(path.join(directory, "package-lock.json")))
  )
    throw new Error("RELEASE_LOCKFILE_CHECKSUM_MISMATCH");
  if (
    manifest.certificationManifestSha256 !==
    sha256(
      fs.readFileSync(
        path.join(
          directory,
          fs.existsSync(path.join(directory, "release-metadata/test-registry.ts"))
            ? "release-metadata/test-registry.ts"
            : "scripts/certification/manifest.ts",
        ),
      ),
    )
  )
    throw new Error("RELEASE_CERTIFICATION_MANIFEST_CHECKSUM_MISMATCH");
  return manifest;
}

if (process.argv[1]?.endsWith("verify.ts") || process.argv[1]?.endsWith("verify.js")) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: verify.ts <release-directory> [expected-sha]");
  console.log(JSON.stringify(verifyReleaseDirectory(path.resolve(directory), process.argv[3])));
}
