import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabaseTargetIdentity } from "../src/data/database";
import { verifyReleaseDirectory } from "./release/verify";

type DeployConfig = {
  readonly sha: string;
  readonly artifact: string;
  readonly host: string;
  readonly user: string;
  readonly keyPath: string;
  readonly appDirectory: string;
  readonly expectedDatabaseFingerprint: string;
  readonly recoveryCommand: string;
  readonly readinessUrl: string;
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`DEPLOY_CONFIG_REQUIRED: ${name}`);
  return value;
};

function parseConfig(): DeployConfig {
  const sha = process.argv[2];
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha))
    throw new Error("Usage: npm run deploy -- <approved-40-character-sha>");
  const artifact = path.resolve(required("RADAR_DEPLOY_ARTIFACT"));
  if (!fs.isFileSync(artifact)) throw new Error("DEPLOY_ARTIFACT_MISSING");
  const keyPath = path.resolve(required("RADAR_DEPLOY_SSH_KEY_PATH"));
  if (!fs.isFileSync(keyPath)) throw new Error("DEPLOY_SSH_KEY_MISSING");
  return {
    sha,
    artifact,
    keyPath,
    host: required("RADAR_DEPLOY_SSH_HOST"),
    user: required("RADAR_DEPLOY_SSH_USER"),
    appDirectory: required("RADAR_DEPLOY_APP_DIRECTORY"),
    expectedDatabaseFingerprint: required("RADAR_DEPLOY_DB_FINGERPRINT"),
    recoveryCommand: required("RADAR_DEPLOY_RECOVERY_COMMAND"),
    readinessUrl: required("RADAR_DEPLOY_READINESS_URL"),
  };
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sshArgs(config: DeployConfig, command: string): string[] {
  return [
    "-o",
    "StrictHostKeyChecking=yes",
    "-i",
    config.keyPath,
    `${config.user}@${config.host}`,
    command,
  ];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function validatePreMutation(config: DeployConfig): void {
  const identity = getDatabaseTargetIdentity();
  if (identity.fingerprint !== config.expectedDatabaseFingerprint)
    throw new Error("DEPLOY_DATABASE_TARGET_MISMATCH");
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), "radar-release-verify-"));
  try {
    execFileSync("tar", ["-xzf", config.artifact, "-C", extracted], { stdio: "inherit" });
    verifyReleaseDirectory(extracted, config.sha);
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

/** Deploys a verified, CI-produced release without checking out or building source. */
export function deploy(config = parseConfig()): void {
  validatePreMutation(config);
  process.env.RADAR_RELEASE_SHA = config.sha;
  process.env.RADAR_DEPLOY_READINESS_URL = config.readinessUrl;
  const releaseName = `radar-release-${config.sha}.tar.gz`;
  const remoteArtifact = `${config.appDirectory}/releases/${releaseName}`;
  const stagingDirectory = `${config.appDirectory}/releases/${config.sha}`;
  const receipt = `${config.appDirectory}/releases/${config.sha}.receipt.json`;
  const writers = [
    "radar-scrape",
    "radar-enrich",
    "radar-documents",
    "radar-evaluate",
    "radar-dossiers",
    "radar-reviews",
    "radar-corpus",
  ];

  // The recovery command is supplied by the operator's actual database
  // provider. Its non-empty result is persisted as the recovery-point ID.
  const recoveryPoint = run("ssh", sshArgs(config, `set -eu; ${config.recoveryCommand}`));
  if (!recoveryPoint) throw new Error("DEPLOY_RECOVERY_POINT_UNVERIFIED");
  const priorSha = run(
    "ssh",
    sshArgs(config, `cat ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)} 2>/dev/null`),
  );

  run("ssh", sshArgs(config, `set -eu; mkdir -p ${shellQuote(`${config.appDirectory}/releases`)}`));
  run("scp", [
    "-o",
    "StrictHostKeyChecking=yes",
    "-i",
    config.keyPath,
    config.artifact,
    `${config.user}@${config.host}:${remoteArtifact}`,
  ]);
  const stopWriters = writers.map((name) => `pm2 stop ${name}`).join("; ");
  const activate = [
    "set -eu",
    `rm -rf ${shellQuote(stagingDirectory)}`,
    `mkdir -p ${shellQuote(stagingDirectory)}`,
    `tar -xzf ${shellQuote(remoteArtifact)} -C ${shellQuote(stagingDirectory)}`,
    `cd ${shellQuote(stagingDirectory)}`,
    `node_modules/.bin/tsx scripts/release/verify.ts . ${shellQuote(config.sha)}`,
    `export RADAR_RELEASE_SHA=${shellQuote(config.sha)}`,
    stopWriters,
    "pm2 stop radar-v2",
    "npm run db:migrate",
    "npm run db:status",
    `printf '%s' ${shellQuote(config.sha)} > ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)}`,
    `pm2 startOrRestart ecosystem.config.cjs --only radar-v2 --update-env`,
    `curl --fail --silent --show-error ${shellQuote(`${config.readinessUrl.replace(/\/$/, "")}/health/ready`)}`,
    `RADAR_RELEASE_SHA=${shellQuote(config.sha)} node_modules/.bin/tsx scripts/smoke_production.ts`,
  ].join("; ");
  try {
    run("ssh", sshArgs(config, activate));
  } catch (error) {
    const failedReceipt = JSON.stringify({
      previousSha: priorSha || null,
      newSha: config.sha,
      databaseFingerprint: config.expectedDatabaseFingerprint,
      recoveryPoint,
      status: "failed",
      workersStarted: false,
      error: error instanceof Error ? error.message : String(error),
    });
    const recovery = [
      "set +e",
      `printf '%s' ${shellQuote(failedReceipt)} > ${shellQuote(receipt)}`,
      priorSha
        ? `printf '%s' ${shellQuote(priorSha)} > ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)}; pm2 restart radar-v2`
        : "pm2 stop radar-v2",
    ].join("; ");
    try {
      run("ssh", sshArgs(config, recovery));
    } catch {
      // Preserve the original deployment failure; remote recovery is best effort.
    }
    throw error;
  }

  const readiness = run("curl", [
    "--fail",
    "--silent",
    "--show-error",
    `${config.readinessUrl.replace(/\/$/, "")}/health/ready`,
  ]);
  const payload = JSON.parse(readiness) as { status?: string; releaseSha?: string };
  if (payload.status !== "ready" || payload.releaseSha !== config.sha) {
    const failedReceipt = JSON.stringify({
      previousSha: priorSha || null,
      newSha: config.sha,
      databaseFingerprint: config.expectedDatabaseFingerprint,
      recoveryPoint,
      status: "failed",
      workersStarted: false,
      error: "DEPLOY_READINESS_OR_RELEASE_SHA_FAILED",
    });
    const rollback = `set +e; printf '%s' ${shellQuote(failedReceipt)} > ${shellQuote(receipt)}; ${priorSha ? `printf '%s' ${shellQuote(priorSha)} > ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)}; ` : ""}pm2 restart radar-v2`;
    run("ssh", sshArgs(config, rollback));
    throw new Error("DEPLOY_READINESS_OR_RELEASE_SHA_FAILED");
  }
  const releaseReceipt = JSON.stringify({
    previousSha: priorSha || null,
    newSha: config.sha,
    databaseFingerprint: config.expectedDatabaseFingerprint,
    recoveryPoint,
    status: "web-ready",
    workersStarted: false,
  });
  run(
    "ssh",
    sshArgs(config, `printf '%s' ${shellQuote(releaseReceipt)} > ${shellQuote(receipt)}; pm2 save`),
  );
}

if (process.argv[1]?.endsWith("deploy.ts") || process.argv[1]?.endsWith("deploy.js")) {
  try {
    deploy();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
