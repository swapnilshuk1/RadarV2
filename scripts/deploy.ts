import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabaseTargetIdentity } from "../src/data/database";
import { verifyReleaseDirectory } from "./release/verify";

export type DeployConfig = {
  readonly sha: string;
  readonly artifact: string;
  readonly host: string;
  readonly user: string;
  readonly keyPath: string;
  readonly appDirectory: string;
  readonly expectedDatabaseFingerprint: string;
  readonly recoveryCommand: string;
  readonly readinessUrl: string;
  readonly deploymentMode: "single_host" | "distributed";
  readonly serverScraperEnabled?: boolean;
};

export type CommandRunner = (command: string, args: string[]) => string;

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
  if (!fs.existsSync(artifact) || !fs.statSync(artifact).isFile())
    throw new Error("DEPLOY_ARTIFACT_MISSING");
  const keyPath = path.resolve(required("RADAR_DEPLOY_SSH_KEY_PATH"));
  if (!fs.existsSync(keyPath) || !fs.statSync(keyPath).isFile())
    throw new Error("DEPLOY_SSH_KEY_MISSING");
  const deploymentMode = required("RADAR_DEPLOYMENT_MODE");
  if (deploymentMode !== "single_host" && deploymentMode !== "distributed") {
    throw new Error("DEPLOY_MODE_INVALID");
  }
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
    deploymentMode,
    serverScraperEnabled: process.env.RADAR_SERVER_SCRAPER_ENABLED === "true",
  };
}

const MAX_FAILURE_DIAGNOSTIC_CHARS = 4_000;

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

/** Keeps actionable remote stage output while preventing deploy logs from carrying secrets. */
export function commandFailureMessage(command: string, failure: unknown): string {
  const captured = failure as { stdout?: unknown; stderr?: unknown };
  const diagnostic = [outputText(captured?.stdout), outputText(captured?.stderr)]
    .filter(Boolean)
    .join("\n")
    .replace(
      /\b(TURSO_(?:AUTH_)?TOKEN|RESEND_API_KEY|TAVILY_API_KEY|BEDROCK_MANTLE_API_KEY|RADAR_CREDENTIAL_ENCRYPTION_KEY|GOOGLE_CLIENT_SECRET|CLOUDFLARE_API_TOKEN|AWS_SECRET_ACCESS_KEY)\s*([:=])\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      "$1$2[redacted]",
    )
    .replace(/\b(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^@\s/]+@/gi, "$1[redacted]@")
    .replace(/\bre_[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .trim()
    .slice(-MAX_FAILURE_DIAGNOSTIC_CHARS);
  return diagnostic
    ? `DEPLOY_COMMAND_FAILED: ${command}\n--- remote output ---\n${diagnostic}`
    : `DEPLOY_COMMAND_FAILED: ${command}`;
}

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    // Do not use error.message: execFileSync includes the entire command, which
    // may contain a provider recovery command or other operator-supplied secret.
    throw new Error(commandFailureMessage(command, error));
  }
}

export function sshArgs(config: DeployConfig, command: string): string[] {
  return [
    "-o",
    "StrictHostKeyChecking=yes",
    "-i",
    config.keyPath,
    `${config.user}@${config.host}`,
    command,
  ];
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function deployStage(stage: string, command: string): string {
  return `printf '%s\\n' ${shellQuote(`RADAR_DEPLOY_STAGE=${stage}`)} >&2; ${command}`;
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
export function deploy(config = parseConfig(), runner: CommandRunner = run): void {
  validatePreMutation(config);
  process.env.RADAR_RELEASE_SHA = config.sha;
  process.env.RADAR_DEPLOY_READINESS_URL = config.readinessUrl;
  const releaseName = `radar-release-${config.sha}.tar.gz`;
  const remoteArtifact = `${config.appDirectory}/releases/${releaseName}`;
  const stagingDirectory = `${config.appDirectory}/releases/${config.sha}`;
  const receipt = `${config.appDirectory}/releases/${config.sha}.receipt.json`;
  const allManagedWorkers = [
    "radar-scrape",
    "radar-enrich",
    "radar-documents",
    "radar-evaluate",
    "radar-dossiers",
    "radar-reviews",
    "radar-corpus",
    "radar-pursuit",
  ];
  const runServerScraper = config.serverScraperEnabled === true;
  const writers = runServerScraper
    ? allManagedWorkers
    : allManagedWorkers.filter((name) => name !== "radar-scrape");
  const requiredProcesses = ["radar-v2", ...writers];
  const startAllProcesses = "pm2 start ecosystem.config.cjs --update-env";
  // PM2 restart keeps the old cwd for existing names. Recreate only RADAR's
  // managed processes so every process uses the newly extracted release.
  // PM2's multi-name delete stops at a missing name (e.g. disabled radar-scrape).
  // Delete independently so every existing writer actually leaves the old cwd.
  const replaceManagedProcesses = ["radar-v2", ...allManagedWorkers, "radar-admin-bench"]
    .map((name) => `(pm2 delete ${shellQuote(name)} >/dev/null 2>&1 || true)`)
    .join(" && ");
  const enforceProcessTopology = runServerScraper
    ? ":"
    : "pm2 stop 'radar-scrape' >/dev/null 2>&1 || true";
  const verifyAllProcesses = [
    `RADAR_PM2_REQUIRED=${shellQuote(JSON.stringify(requiredProcesses))}`,
    "node -e",
    shellQuote(
      `const {execFileSync}=require("node:child_process"); const required=JSON.parse(process.env.RADAR_PM2_REQUIRED||"[]"); const apps=JSON.parse(execFileSync("pm2",["jlist"],{encoding:"utf8"})); const cwd=process.cwd(); const bad=required.filter((name)=>{ const app=apps.find((candidate)=>candidate.name===name); return !app || app.pm2_env?.status!=="online" || app.pm2_env?.pm_cwd!==cwd; }); if(bad.length){ console.error("PM2_TOPOLOGY_UNHEALTHY:"+bad.join(",")); process.exit(1); }`,
    ),
  ].join(" ");
  const systemReadinessUrl = `${config.readinessUrl.replace(/\/$/, "")}/health/system`;
  const loadHostEnvironment = `set -a; . ${shellQuote(`${config.appDirectory}/.env`)}; set +a`;
  const waitForSystemReadiness = [
    "system_ready=0",
    "readiness_deadline=$((SECONDS + 180))",
    `while [ "$SECONDS" -lt "$readiness_deadline" ]; do if curl --max-time 5 --fail --silent ${shellQuote(systemReadinessUrl)} >/dev/null 2>&1; then system_ready=1; break; fi; sleep 2; done`,
    `[ "$system_ready" = "1" ]`,
  ].join(" && ");

  // The recovery command is supplied by the operator's actual database
  // provider. Its non-empty result is persisted as the recovery-point ID.
  const recoveryPoint = runner("ssh", sshArgs(config, `set -eu; ${config.recoveryCommand}`));
  if (!recoveryPoint) throw new Error("DEPLOY_RECOVERY_POINT_UNVERIFIED");

  // Previous-release discovery: reading CURRENT_SHA must succeed when the file does not yet exist.
  const readPriorShaCommand = `if [ -f ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)} ]; then cat ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)}; fi`;
  const rawPriorSha = runner("ssh", sshArgs(config, readPriorShaCommand));
  const priorSha = rawPriorSha && /^[0-9a-f]{40}$/i.test(rawPriorSha) ? rawPriorSha : null;

  // A serving release can acquire runtime files after extraction, so its
  // payload checksum is not a reliable rollback check. Require the previous
  // release directory and an exact, healthy live readiness response instead.
  const priorReleaseDirectory = priorSha ? `${config.appDirectory}/releases/${priorSha}` : null;
  let priorReleaseVerified = false;
  if (priorSha && priorReleaseDirectory) {
    const verifyPriorCommand = [
      `if [ -d ${shellQuote(priorReleaseDirectory)} ] && [ -d ${shellQuote(`${priorReleaseDirectory}/src/data/sqlite/migrations`)} ] && [ -f ${shellQuote(`${priorReleaseDirectory}/ecosystem.config.cjs`)} ] && [ -f ${shellQuote(`${priorReleaseDirectory}/release-manifest.json`)} ] && [ -f ${shellQuote(`${priorReleaseDirectory}/node_modules/.bin/tsx`)} ]; then`,
      `  (curl --fail --silent --show-error ${shellQuote(`${config.readinessUrl.replace(/\/$/, "")}/health/ready`)} | RADAR_PREVIOUS_SHA=${shellQuote(priorSha)} node -e ${shellQuote('const fs=require("node:fs"); const response=JSON.parse(fs.readFileSync(0,"utf8")); if(response.status!=="ready" || response.releaseSha!==process.env.RADAR_PREVIOUS_SHA) process.exit(1)')} && echo "VERIFIED") || echo "FAILED";`,
      `fi`,
    ].join(" ");
    const priorCheckResult = runner("ssh", sshArgs(config, verifyPriorCommand));
    if (priorCheckResult === "VERIFIED") {
      priorReleaseVerified = true;
    }
  }
  if (priorSha && !priorReleaseVerified) throw new Error("DEPLOY_PREVIOUS_RELEASE_NOT_READY");

  runner(
    "ssh",
    sshArgs(config, `set -eu; mkdir -p ${shellQuote(`${config.appDirectory}/releases`)}`),
  );
  const artifactStatus = runner(
    "ssh",
    sshArgs(
      config,
      `if [ -s ${shellQuote(remoteArtifact)} ]; then printf READY; else printf MISSING; fi`,
    ),
  );
  if (artifactStatus !== "READY") {
    runner("scp", [
      "-o",
      "StrictHostKeyChecking=yes",
      "-i",
      config.keyPath,
      config.artifact,
      `${config.user}@${config.host}:${remoteArtifact}`,
    ]);
  }

  // Migration ledgers remain forward-only. Seed the retained release directory
  // with only missing SQL files before migrating so it can validate the changed
  // database if activation has to return to that release.
  const preservePriorMigrationCatalog = priorReleaseDirectory
    ? `for migration in src/data/sqlite/migrations/*.sql; do [ -f "$migration" ] || continue; cp -n "$migration" ${shellQuote(`${priorReleaseDirectory}/src/data/sqlite/migrations/`)}; done`
    : ":";
  const activationSteps = [
    [
      "extract",
      `rm -rf ${shellQuote(stagingDirectory)} && mkdir -p ${shellQuote(stagingDirectory)} && tar -xzf ${shellQuote(remoteArtifact)} -C ${shellQuote(stagingDirectory)}`,
    ],
    [
      "release_verify",
      `cd ${shellQuote(stagingDirectory)} && node_modules/.bin/tsx scripts/release/verify.ts . ${shellQuote(config.sha)}`,
    ],
    ["host_environment", loadHostEnvironment],
    [
      "runtime_configuration",
      `export RADAR_RELEASE_SHA=${shellQuote(config.sha)} && export RADAR_EXPECTED_DB_TARGET_FINGERPRINT=${shellQuote(config.expectedDatabaseFingerprint)} && export RADAR_DEPLOYMENT_MODE=${shellQuote(config.deploymentMode)} && export RADAR_SERVER_SCRAPER_ENABLED=${shellQuote(String(runServerScraper))}`,
    ],
    ...(priorReleaseDirectory
      ? [["prior_release_migration_catalog", preservePriorMigrationCatalog] as const]
      : []),
    ["replace_processes", replaceManagedProcesses],
    ["migrate", "npm run db:migrate"],
    ["migration_status", "npm run db:status"],
    ["start_processes", `${startAllProcesses} && ${enforceProcessTopology}`],
    ["system_readiness", waitForSystemReadiness],
    ["process_topology", verifyAllProcesses],
    [
      "ready",
      `curl --fail --silent --show-error ${shellQuote(`${config.readinessUrl.replace(/\/$/, "")}/health/ready`)}`,
    ],
    [
      "production_smoke",
      `RADAR_DEPLOY_READINESS_URL=${shellQuote(config.readinessUrl)} RADAR_RELEASE_SHA=${shellQuote(config.sha)} node_modules/.bin/tsx scripts/smoke_production.ts`,
    ],
    [
      "record_current_sha",
      `printf '%s' ${shellQuote(config.sha)} > ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)}`,
    ],
  ] as const;
  const activate = [
    "set -eu",
    ...activationSteps.map(([stage, command]) => deployStage(stage, command)),
  ].join(" && ");

  function rollback(errorMessage: string): void {
    const canRestorePrior = Boolean(priorSha && priorReleaseVerified && priorReleaseDirectory);
    const verifyPriorReadiness = `curl --max-time 15 --fail --silent --show-error ${shellQuote(`${config.readinessUrl.replace(/\/$/, "")}/health/ready`)} | RADAR_PREVIOUS_SHA=${shellQuote(priorSha ?? "")} node -e ${shellQuote('const fs=require("node:fs"); const response=JSON.parse(fs.readFileSync(0,"utf8")); if(response.status!=="ready" || response.releaseSha!==process.env.RADAR_PREVIOUS_SHA) process.exit(1)')}`;
    const rollbackFailedReceipt = JSON.stringify({
      previousSha: priorSha || null,
      newSha: config.sha,
      databaseFingerprint: config.expectedDatabaseFingerprint,
      deploymentMode: config.deploymentMode,
      recoveryPoint,
      status: "failed",
      rollback: "rollback_failed",
      databaseRestored: false,
      workersStarted: false,
      error: errorMessage,
    });
    const rollbackSuccessReceipt = JSON.stringify({
      previousSha: priorSha || null,
      newSha: config.sha,
      databaseFingerprint: config.expectedDatabaseFingerprint,
      deploymentMode: config.deploymentMode,
      recoveryPoint,
      status: "failed",
      rollback: "previous-release-restored",
      databaseRestored: false,
      workersStarted: true,
      error: errorMessage,
    });
    const rollbackUnavailableReceipt = JSON.stringify({
      previousSha: priorSha || null,
      newSha: config.sha,
      databaseFingerprint: config.expectedDatabaseFingerprint,
      deploymentMode: config.deploymentMode,
      recoveryPoint,
      status: "failed",
      rollback: priorSha
        ? "previous-release-unverified-web-stopped"
        : "no-previous-release-web-stopped",
      databaseRestored: false,
      workersStarted: false,
      error: errorMessage,
    });

    const recovery = [
      "set +e",
      loadHostEnvironment,
      canRestorePrior
        ? [
            `printf '%s' ${shellQuote(rollbackFailedReceipt)} > ${shellQuote(receipt)}`,
            `if (cd ${shellQuote(priorReleaseDirectory!)} && export RADAR_RELEASE_SHA=${shellQuote(priorSha!)} && export RADAR_EXPECTED_DB_TARGET_FINGERPRINT=${shellQuote(config.expectedDatabaseFingerprint)} && export RADAR_DEPLOYMENT_MODE=${shellQuote(config.deploymentMode)} && export RADAR_SERVER_SCRAPER_ENABLED=${shellQuote(String(runServerScraper))} && ${replaceManagedProcesses} && npm run db:status && ${startAllProcesses} && ${waitForSystemReadiness} && ${verifyAllProcesses} && ${verifyPriorReadiness} && printf '%s' ${shellQuote(priorSha!)} > ${shellQuote(`${config.appDirectory}/CURRENT_SHA`)}); then`,
            `  printf '%s' ${shellQuote(rollbackSuccessReceipt)} > ${shellQuote(receipt)}`,
            `else`,
            ...requiredProcesses.map((name) => `  pm2 stop ${shellQuote(name)} || true`),
            `fi`,
          ].join("\n")
        : [
            ...requiredProcesses.map((name) => `pm2 stop ${shellQuote(name)} || true`),
            `printf '%s' ${shellQuote(rollbackUnavailableReceipt)} > ${shellQuote(receipt)}`,
          ].join("\n"),
    ].join("\n");
    try {
      runner("ssh", sshArgs(config, recovery));
    } catch {
      // Preserve the original deployment failure; remote recovery is best effort.
    }
  }

  try {
    runner("ssh", sshArgs(config, activate));
  } catch (error) {
    rollback(error instanceof Error ? error.message : String(error));
    throw error;
  }

  let readiness: string;
  try {
    readiness = runner("curl", [
      "--fail",
      "--silent",
      "--show-error",
      `${config.readinessUrl.replace(/\/$/, "")}/health/ready`,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rollback(message);
    throw error;
  }

  const payload = JSON.parse(readiness) as { status?: string; releaseSha?: string };
  if (payload.status !== "ready" || payload.releaseSha !== config.sha) {
    const errorMsg = "DEPLOY_READINESS_OR_RELEASE_SHA_FAILED";
    rollback(errorMsg);
    throw new Error(errorMsg);
  }

  const releaseReceipt = JSON.stringify({
    previousSha: priorSha || null,
    newSha: config.sha,
    databaseFingerprint: config.expectedDatabaseFingerprint,
    deploymentMode: config.deploymentMode,
    recoveryPoint,
    status: "ready",
    workersStarted: true,
  });
  runner(
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
