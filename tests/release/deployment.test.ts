import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getDatabaseTargetIdentity } from "../../src/data/database";
import { releasePayloadChecksum } from "../../scripts/release/package";
import {
  commandFailureMessage,
  deploy,
  type CommandRunner,
  type DeployConfig,
} from "../../scripts/deploy";

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function createTestArtifact(sha: string, tempDirs: string[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-test-release-"));
  tempDirs.push(directory);
  fs.mkdirSync(path.join(directory, "scripts/certification"), { recursive: true });
  fs.writeFileSync(path.join(directory, "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(
    path.join(directory, "scripts/certification/manifest.ts"),
    "export const manifest = [];\n",
  );
  fs.writeFileSync(path.join(directory, "payload.txt"), "certified\n");
  const manifest = {
    commitSha: sha,
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

  const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-test-archive-"));
  tempDirs.push(archiveDir);
  const tarballPath = path.join(archiveDir, `radar-release-${sha}.tar.gz`);
  execFileSync("tar", ["-czf", tarballPath, "-C", directory, "."]);
  return tarballPath;
}

function createTestKey(tempDirs: string[]): string {
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-test-key-"));
  tempDirs.push(keyDir);
  const keyPath = path.join(keyDir, "id_rsa");
  fs.writeFileSync(keyPath, "dummy-key-content\n");
  return keyPath;
}

describe("deterministic release deployment", () => {
  const tempDirs: string[] = [];
  const testSha = "a".repeat(40);

  afterEach(() => {
    tempDirs
      .splice(0)
      .forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  function makeConfig(): DeployConfig {
    return {
      sha: testSha,
      artifact: createTestArtifact(testSha, tempDirs),
      keyPath: createTestKey(tempDirs),
      host: "deploy.example.internal",
      user: "radar",
      appDirectory: "/srv/radar",
      expectedDatabaseFingerprint: getDatabaseTargetIdentity().fingerprint,
      recoveryCommand: "echo rec-12345",
      readinessUrl: "http://127.0.0.1:3000",
      deploymentMode: "single_host",
    };
  }

  it("supports first deployment cleanly when CURRENT_SHA does not exist", () => {
    const config = makeConfig();
    const commands: { command: string; args: string[] }[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      commands.push({ command, args });
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return "";
        return "";
      }
      if (command === "curl") {
        const url = args[args.length - 1];
        return JSON.stringify(
          url.endsWith("/health/system")
            ? {
                status: "ready",
                releaseSha: testSha,
                workers: { required: 7, healthy: 7, missing: [] },
              }
            : { status: "ready", releaseSha: testSha },
        );
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).not.toThrow();

    const readShaInvocation = commands.find(
      (c) =>
        c.command === "ssh" &&
        c.args[c.args.length - 1].includes("CURRENT_SHA") &&
        c.args[c.args.length - 1].startsWith("if [ -f "),
    );
    expect(readShaInvocation).toBeDefined();

    const receiptInvocation = commands.find(
      (c) => c.command === "ssh" && c.args[c.args.length - 1].includes(".receipt.json"),
    );
    expect(receiptInvocation).toBeDefined();
    expect(receiptInvocation?.args[receiptInvocation.args.length - 1]).toContain(
      '"previousSha":null',
    );
    expect(receiptInvocation?.args[receiptInvocation.args.length - 1]).toContain(
      '"status":"ready"',
    );
  });

  it("reuses a release archive already present on the target host", () => {
    const config = makeConfig();
    const commands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      commands.push(`${command} ${args.join(" ")}`);
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return "";
        if (cmdStr.includes("printf READY")) return "READY";
      }
      if (command === "curl") {
        const url = args[args.length - 1];
        return JSON.stringify(
          url.endsWith("/health/system")
            ? {
                status: "ready",
                releaseSha: testSha,
                workers: { required: 7, healthy: 7, missing: [] },
              }
            : { status: "ready", releaseSha: testSha },
        );
      }
      return "";
    };

    deploy(config, mockRunner);

    expect(commands.some((command) => command.startsWith("scp "))).toBe(false);
  });

  it("recreates managed PM2 processes from the new release directory", () => {
    const config = makeConfig();
    let capturedActivation = "";
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (
          cmdStr.includes("rm -rf") &&
          cmdStr.includes("node_modules/.bin/tsx scripts/release/verify.ts")
        ) {
          capturedActivation = cmdStr;
        }
        return "";
      }
      if (command === "curl") {
        const url = args[args.length - 1];
        return JSON.stringify(
          url.endsWith("/health/system")
            ? {
                status: "ready",
                releaseSha: testSha,
                workers: { required: 7, healthy: 7, missing: [] },
              }
            : { status: "ready", releaseSha: testSha },
        );
      }
      return "";
    };

    deploy(config, mockRunner);

    expect(capturedActivation).toContain("(pm2 delete 'radar-v2' >/dev/null 2>&1 || true)");
    expect(capturedActivation).toContain(
      "(pm2 delete 'radar-scrape' >/dev/null 2>&1 || true) && (pm2 delete 'radar-enrich'",
    );
    expect(capturedActivation).toContain("pm2 start ecosystem.config.cjs --update-env");
    expect(capturedActivation.indexOf("pm2 delete")).toBeLessThan(
      capturedActivation.indexOf("npm run db:migrate"),
    );
    expect(capturedActivation).not.toContain("--only radar-v2");
    expect(capturedActivation).toContain("PM2_TOPOLOGY_UNHEALTHY");
    expect(capturedActivation).toContain("RADAR_EXPECTED_DB_TARGET_FINGERPRINT");
    expect(capturedActivation).toContain("set -a; . '/srv/radar/.env'; set +a");
    expect(capturedActivation.indexOf("set -a; . '/srv/radar/.env'; set +a")).toBeLessThan(
      capturedActivation.indexOf("npm run db:migrate"),
    );
    expect(capturedActivation).toContain("/health/system");
    expect(capturedActivation).toContain("system_ready=0");
    expect(capturedActivation).toContain("RADAR_DEPLOY_STAGE=migrate");
    expect(capturedActivation).toContain("readiness_deadline=$((SECONDS + 180))");
    expect(capturedActivation.indexOf("system_ready=0")).toBeLessThan(
      capturedActivation.indexOf("RADAR_PM2_REQUIRED="),
    );
  });

  it("hands forward migration files to the verified prior release before migrating", () => {
    const config = makeConfig();
    const priorSha = "b".repeat(40);
    let activation = "";
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmd = args[args.length - 1];
        if (cmd.includes("echo rec-12345")) return "rec-12345";
        if (cmd.includes("RADAR_DISCOVER_LIVE_SHA")) return priorSha;
        if (cmd.includes("CURRENT_SHA") && cmd.startsWith("if [ -f ")) return priorSha;
        if (cmd.startsWith("if [ -d ") && cmd.includes(`releases/${priorSha}`)) return "VERIFIED";
        if (cmd.includes("RADAR_DEPLOY_STAGE=prior_release_migration_catalog")) activation = cmd;
      }
      if (command === "curl") return JSON.stringify({ status: "ready", releaseSha: testSha });
      return "";
    };

    deploy(config, mockRunner);

    const handoffIndex = activation.indexOf("RADAR_DEPLOY_STAGE=prior_release_migration_catalog");
    const migrateIndex = activation.indexOf("RADAR_DEPLOY_STAGE=migrate");
    expect(activation).toContain(
      `cp -n \"$migration\" '/srv/radar/releases/${priorSha}/src/data/sqlite/migrations/'`,
    );
    expect(handoffIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeGreaterThan(handoffIndex);
  });

  it("keeps remote failure stages while redacting credential material", () => {
    const message = commandFailureMessage("ssh", {
      stdout: "RADAR_DEPLOY_STAGE=migrate\nTURSO_AUTH_TOKEN=secret-value",
      stderr:
        "Authorization: Bearer bearer-secret\nhttps://user:password@example.test/path\nre_12345678901234567890",
    });

    expect(message).toContain("RADAR_DEPLOY_STAGE=migrate");
    expect(message).toContain("TURSO_AUTH_TOKEN=[redacted]");
    expect(message).toContain("Authorization: Bearer [redacted]");
    expect(message).toContain("https://user:[redacted]@example.test/path");
    expect(message).not.toContain("secret-value");
    expect(message).not.toContain("bearer-secret");
    expect(message).not.toContain("password");
    expect(message).not.toContain("re_12345678901234567890");
  });

  it("explicitly passes RADAR_DEPLOY_READINESS_URL and RADAR_RELEASE_SHA to remote smoke", () => {
    const config = makeConfig();
    let capturedActivation = "";
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("scripts/smoke_production.ts")) {
          capturedActivation = cmdStr;
        }
        return "";
      }
      if (command === "curl") {
        const url = args[args.length - 1];
        return JSON.stringify(
          url.endsWith("/health/system")
            ? {
                status: "ready",
                releaseSha: testSha,
                workers: { required: 7, healthy: 7, missing: [] },
              }
            : { status: "ready", releaseSha: testSha },
        );
      }
      return "";
    };

    deploy(config, mockRunner);

    expect(capturedActivation).toContain(
      `RADAR_DEPLOY_READINESS_URL='${config.readinessUrl}' RADAR_RELEASE_SHA='${config.sha}' node_modules/.bin/tsx scripts/smoke_production.ts`,
    );
  });

  it("reactivates the retained previous release directory on post-activation failure", () => {
    const config = makeConfig();
    const priorSha = "b".repeat(40);
    const rollbackCommands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes('status":"failed"')) {
          rollbackCommands.push(cmdStr);
          return "";
        }
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("RADAR_DISCOVER_LIVE_SHA")) return priorSha;
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return priorSha;
        if (cmdStr.startsWith("if [ -d ") && cmdStr.includes(`releases/${priorSha}`))
          return "VERIFIED";
        if (cmdStr.includes("node_modules/.bin/tsx scripts/smoke_production.ts")) {
          throw new Error("SMOKE_FAILED_ON_REMOTE");
        }
        return "";
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).toThrow("SMOKE_FAILED_ON_REMOTE");

    expect(rollbackCommands.length).toBeGreaterThan(0);
    const rollbackCmd = rollbackCommands[0];

    expect(rollbackCmd).toContain(`cd '/srv/radar/releases/${priorSha}'`);
    expect(rollbackCmd).toContain("pm2 delete 'radar-v2'");
    expect(rollbackCmd).toContain("pm2 start ecosystem.config.cjs --update-env");
    expect(rollbackCmd).not.toContain(`cd '/srv/radar/releases/${testSha}'`);
    expect(rollbackCmd).toContain(`printf '%s' '${priorSha}' > '/srv/radar/CURRENT_SHA'`);
    expect(rollbackCmd).toContain("RADAR_SERVER_SCRAPER_ENABLED='false'");
    expect(rollbackCmd).toContain("radar-enrich");
    expect(rollbackCmd).toContain('"databaseRestored":false');
    expect(rollbackCmd).toContain('"rollback":"previous-release-restored"');
    expect(rollbackCmd).toContain('"workersStarted":true');
  });

  it("leaves web stopped when no previous release exists rather than pretending rollback succeeded", () => {
    const config = makeConfig();
    const rollbackCommands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return "";
        if (cmdStr.includes('status":"failed"')) {
          rollbackCommands.push(cmdStr);
          return "";
        }
        if (cmdStr.includes("node_modules/.bin/tsx scripts/smoke_production.ts")) {
          throw new Error("ACTIVATION_FAILED");
        }
        return "";
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).toThrow("ACTIVATION_FAILED");

    expect(rollbackCommands.length).toBeGreaterThan(0);
    const rollbackCmd = rollbackCommands[0];

    expect(rollbackCmd).toContain("pm2 stop 'radar-v2'");
    expect(rollbackCmd).not.toContain("pm2 start ecosystem.config.cjs");
    expect(rollbackCmd).not.toContain("pm2 restart");
    expect(rollbackCmd).not.toContain("CURRENT_SHA");
    expect(rollbackCmd).toContain('"rollback":"no-previous-release-web-stopped"');
    expect(rollbackCmd).toContain('"databaseRestored":false');
  });

  it("uses the healthy live release when CURRENT_SHA is stale", () => {
    const config = makeConfig();
    const stalePointerSha = "b".repeat(40);
    const liveSha = "c".repeat(40);
    let activation = "";
    const commands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        commands.push(cmdStr);
        if (cmdStr.includes("RADAR_DISCOVER_LIVE_SHA")) return liveSha;
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return stalePointerSha;
        if (cmdStr.startsWith("if [ -d ") && cmdStr.includes(`releases/${liveSha}`))
          return "VERIFIED";
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("RADAR_DEPLOY_STAGE=prior_release_migration_catalog"))
          activation = cmdStr;
        return "";
      }
      if (command === "curl") return JSON.stringify({ status: "ready", releaseSha: testSha });
      return "";
    };

    expect(() => deploy(config, mockRunner)).not.toThrow();
    expect(activation).toContain(`/releases/${liveSha}/src/data/sqlite/migrations/`);
    expect(activation).not.toContain(`/releases/${stalePointerSha}/src/data/sqlite/migrations/`);
    expect(commands.some((command) => command.includes(`releases/${liveSha}`))).toBe(true);
  });

  it("fails closed when CURRENT_SHA exists but live readiness cannot identify a release", () => {
    const config = makeConfig();
    const priorSha = "b".repeat(40);
    let recoveryPointCreated = false;
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes("RADAR_DISCOVER_LIVE_SHA")) return "";
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return priorSha;
        if (cmdStr.includes("echo rec-12345")) {
          recoveryPointCreated = true;
          return "rec-12345";
        }
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).toThrow("DEPLOY_PREVIOUS_RELEASE_NOT_READY");
    expect(recoveryPointCreated).toBe(false);
  });

  it("does not begin activation if the previous release is not ready", () => {
    const config = makeConfig();
    const priorSha = "b".repeat(40);
    const commands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        commands.push(cmdStr);
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("RADAR_DISCOVER_LIVE_SHA")) return priorSha;
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return priorSha;
        // The prior release is not healthy at the exact recorded SHA.
        if (cmdStr.startsWith("if [ -d ") && cmdStr.includes(`releases/${priorSha}`))
          return "FAILED";
        return "";
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).toThrow("DEPLOY_PREVIOUS_RELEASE_NOT_READY");
    expect(commands.some((command) => command.includes("rm -rf"))).toBe(false);
  });

  it("ensures a failed PM2 previous-release activation cannot produce a previous-release-restored receipt", () => {
    const config = makeConfig();
    const priorSha = "b".repeat(40);
    const rollbackCommands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes('status":"failed"')) {
          rollbackCommands.push(cmdStr);
          return "";
        }
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("RADAR_DISCOVER_LIVE_SHA")) return priorSha;
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return priorSha;
        if (cmdStr.startsWith("if [ -d ") && cmdStr.includes(`releases/${priorSha}`))
          return "VERIFIED";
        if (cmdStr.includes("node_modules/.bin/tsx scripts/smoke_production.ts")) {
          throw new Error("ACTIVATION_FAILED");
        }
        return "";
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).toThrow("ACTIVATION_FAILED");

    const rollbackCmd = rollbackCommands[0];
    const initialReceiptIndex = rollbackCmd.indexOf('"rollback":"rollback_failed"');
    const activationIndex = rollbackCmd.indexOf("pm2 start ecosystem.config.cjs --update-env");
    const restoredReceiptIndex = rollbackCmd.indexOf('"rollback":"previous-release-restored"');

    // The initial receipt written before activation attempt must record rollback_failed
    expect(initialReceiptIndex).toBeGreaterThan(-1);
    expect(activationIndex).toBeGreaterThan(initialReceiptIndex);
    // previous-release-restored is strictly guarded inside the activation condition
    expect(restoredReceiptIndex).toBeGreaterThan(activationIndex);

    // If PM2 fails, the conditional subshell fails and else block stops radar-v2 without writing previous-release-restored
    expect(rollbackCmd).toContain("else\n  pm2 stop 'radar-v2' || true");
  });

  it("writes previous-release-restored only after activation and CURRENT_SHA restoration", () => {
    const config = makeConfig();
    const priorSha = "b".repeat(40);
    const rollbackCommands: string[] = [];
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmdStr = args[args.length - 1];
        if (cmdStr.includes('status":"failed"')) {
          rollbackCommands.push(cmdStr);
          return "";
        }
        if (cmdStr.includes("echo rec-12345")) return "rec-12345";
        if (cmdStr.includes("RADAR_DISCOVER_LIVE_SHA")) return priorSha;
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return priorSha;
        if (cmdStr.startsWith("if [ -d ") && cmdStr.includes(`releases/${priorSha}`))
          return "VERIFIED";
        if (cmdStr.includes("node_modules/.bin/tsx scripts/smoke_production.ts")) {
          throw new Error("SMOKE_FAILED_ON_REMOTE");
        }
        return "";
      }
      return "";
    };

    expect(() => deploy(config, mockRunner)).toThrow("SMOKE_FAILED_ON_REMOTE");

    const rollbackCmd = rollbackCommands[0];

    // Sequence verification:
    // 1. cd prior release
    // 2. recreate PM2 processes from the prior release
    // 3. CURRENT_SHA update
    // 4. previous-release-restored receipt written
    const cdIndex = rollbackCmd.indexOf(`cd '/srv/radar/releases/${priorSha}'`);
    const pm2Index = rollbackCmd.indexOf("pm2 start ecosystem.config.cjs --update-env");
    const shaUpdateIndex = rollbackCmd.indexOf(
      `printf '%s' '${priorSha}' > '/srv/radar/CURRENT_SHA'`,
    );
    const successReceiptIndex = rollbackCmd.indexOf('"rollback":"previous-release-restored"');

    expect(cdIndex).toBeGreaterThan(-1);
    expect(pm2Index).toBeGreaterThan(cdIndex);
    expect(shaUpdateIndex).toBeGreaterThan(pm2Index);
    expect(successReceiptIndex).toBeGreaterThan(shaUpdateIndex);
    const schemaIndex = rollbackCmd.indexOf("npm run db:status");
    const readyIndex = rollbackCmd.indexOf("/health/ready");
    expect(schemaIndex).toBeGreaterThan(cdIndex);
    expect(schemaIndex).toBeLessThan(pm2Index);
    expect(readyIndex).toBeGreaterThan(pm2Index);
    expect(readyIndex).toBeLessThan(shaUpdateIndex);
    expect(rollbackCmd.slice(readyIndex, shaUpdateIndex)).toContain(priorSha);

    // Atomic subshell verifies all preconditions before success receipt is written
    expect(rollbackCmd).toContain(
      `if (cd '/srv/radar/releases/${priorSha}' && export RADAR_RELEASE_SHA='${priorSha}' && export RADAR_EXPECTED_DB_TARGET_FINGERPRINT='${config.expectedDatabaseFingerprint}' && export RADAR_DEPLOYMENT_MODE='${config.deploymentMode}' && export RADAR_SERVER_SCRAPER_ENABLED='false' && (pm2 delete`,
    );
  });

  it("does not start a server scraper on the pre-production app host", () => {
    const config = makeConfig();
    let activation = "";
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmd = args[args.length - 1];
        if (cmd.includes("echo rec-12345")) return "rec-12345";
        if (cmd.includes("rm -rf") && cmd.includes("scripts/release/verify.ts")) activation = cmd;
        return "";
      }
      if (command === "curl") {
        const url = args[args.length - 1];
        return JSON.stringify(
          url.endsWith("/health/system")
            ? {
                status: "ready",
                releaseSha: testSha,
                workers: { required: 6, healthy: 6, missing: [] },
              }
            : { status: "ready", releaseSha: testSha },
        );
      }
      return "";
    };
    deploy(config, mockRunner);
    expect(activation).toContain("(pm2 delete 'radar-v2' >/dev/null 2>&1 || true)");
    for (const name of [
      "radar-enrich",
      "radar-evaluate",
      "radar-documents",
      "radar-dossiers",
      "radar-reviews",
      "radar-corpus",
      "radar-pursuit",
    ]) {
      expect(activation).toContain(`(pm2 delete '${name}' >/dev/null 2>&1 || true)`);
    }
    expect(activation).toContain("RADAR_DEPLOYMENT_MODE='single_host'");
    expect(activation).toContain("RADAR_SERVER_SCRAPER_ENABLED='false'");
    expect(activation).not.toContain('RADAR_PM2_REQUIRED=\'["radar-v2","radar-scrape"');
  });

  it("includes the scraper only for an explicitly enabled host", () => {
    const config = { ...makeConfig(), serverScraperEnabled: true };
    let activation = "";
    const mockRunner: CommandRunner = (command, args) => {
      if (command === "ssh") {
        const cmd = args[args.length - 1];
        if (cmd.includes("echo rec-12345")) return "rec-12345";
        if (cmd.includes("rm -rf") && cmd.includes("scripts/release/verify.ts")) activation = cmd;
      }
      if (command === "curl") return JSON.stringify({ status: "ready", releaseSha: testSha });
      return "";
    };
    deploy(config, mockRunner);
    expect(activation).toContain("RADAR_SERVER_SCRAPER_ENABLED='true'");
    expect(activation).toContain('RADAR_PM2_REQUIRED=\'["radar-v2","radar-scrape"');
  });
});
