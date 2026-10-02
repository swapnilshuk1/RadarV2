import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { BENCH_FIXTURE_VERSION } from "./bench-version";

/** Trusted deployment settings only. No credential values are hashed or persisted. */
export function benchEnvironment() {
  const target = process.env.RADAR_ADMIN_BENCH_TARGET?.trim();
  const release = process.env.RADAR_RELEASE_SHA?.trim();
  const hosts = process.env.RADAR_ADMIN_BENCH_HOSTS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  if (!target || !release || !/^[a-f0-9]{40}$/i.test(release) || !hosts?.length)
    throw new Error("BENCH_DEPLOYMENT_IDENTITY_REQUIRED");
  const references = Object.fromEntries(
    [
      "RADAR_GLM_MODEL",
      "RADAR_DOSSIER_WRITER_MODEL",
      "RADAR_FACTUAL_REVIEW_PROVIDER",
      "RADAR_PURSUIT_MANTLE_MODEL",
      "RADAR_PURSUIT_ENABLE_GEMINI",
      "GCP_PROJECT_ID",
      "AWS_REGION",
      "RADAR_MODEL_CREDENTIAL_VERSION",
    ].map((key) => [key, process.env[key] ?? "default"]),
  );
  return {
    target,
    release: release.toLowerCase(),
    hosts,
    fixtureVersion: BENCH_FIXTURE_VERSION,
    providerConfiguration: createHash("sha256").update(JSON.stringify(references)).digest("hex"),
    credentialReference: "BEDROCK_MANTLE_API_KEY / host ADC; version reference only",
  };
}
export function workerEnvironment() {
  const expected = benchEnvironment();
  if (!expected.hosts.includes(hostname())) throw new Error("BENCH_WORKER_HOST_NOT_ALLOWED");
  return {
    ...expected,
    hostname: hostname(),
    instance: randomUUID(),
    architecture: process.arch,
    runtime: process.version,
    platform: process.platform,
  };
}
export function assertBenchEnvironment(
  expectedJson: string | null | undefined,
  workerJson?: string | null,
) {
  const expected = benchEnvironment();
  if (!expectedJson || JSON.stringify(JSON.parse(expectedJson)) !== JSON.stringify(expected))
    throw new Error("BENCH_RELEASE_OR_ENVIRONMENT_CHANGED");
  if (workerJson !== undefined) {
    if (!workerJson) throw new Error("BENCH_WORKER_ATTESTATION_REQUIRED");
    const worker = JSON.parse(workerJson);
    if (
      !worker.instance ||
      !worker.architecture ||
      !worker.runtime ||
      !expected.hosts.includes(worker.hostname) ||
      Object.keys(expected).some(
        (key) =>
          JSON.stringify(worker[key]) !== JSON.stringify(expected[key as keyof typeof expected]),
      )
    )
      throw new Error("BENCH_WORKER_ATTESTATION_MISMATCH");
  }
}
