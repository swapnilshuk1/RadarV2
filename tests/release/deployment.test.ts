import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getDatabaseTargetIdentity } from "../../src/data/database";
import { releasePayloadChecksum } from "../../scripts/release/package";
import { deploy, type CommandRunner, type DeployConfig } from "../../scripts/deploy";

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
        return JSON.stringify({ status: "ready", releaseSha: testSha });
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
      '"status":"web-ready"',
    );
  });

  it("tolerates absent or stopped PM2 worker processes but fails closed on real errors", () => {
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
        return JSON.stringify({ status: "ready", releaseSha: testSha });
      }
      return "";
    };

    deploy(config, mockRunner);

    expect(capturedActivation).toContain("stop_pm2_process()");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-scrape'");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-enrich'");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-documents'");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-evaluate'");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-dossiers'");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-reviews'");
    expect(capturedActivation).toContain("stop_pm2_process 'radar-corpus'");
    expect(capturedActivation).toContain("stop_pm2_process radar-v2");

    expect(capturedActivation).toMatch(
      /grep -qiE "\(process\|namespace\)\.\*not found\|already stopped"/,
    );
    expect(capturedActivation).toMatch(/! echo "\$pm2_out" \| grep -qi "command not found"/);
    expect(capturedActivation).toContain('echo "$pm2_out" >&2');
    expect(capturedActivation).toContain("return 1");
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
        return JSON.stringify({ status: "ready", releaseSha: testSha });
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
    expect(rollbackCmd).toContain(
      "pm2 startOrRestart ecosystem.config.cjs --only radar-v2 --update-env",
    );
    expect(rollbackCmd).not.toContain(`cd '/srv/radar/releases/${testSha}'`);
    expect(rollbackCmd).toContain(`printf '%s' '${priorSha}' > '/srv/radar/CURRENT_SHA'`);
    expect(rollbackCmd).not.toContain("radar-scrape");
    expect(rollbackCmd).not.toContain("radar-enrich");
    expect(rollbackCmd).toContain('"databaseRestored":false');
    expect(rollbackCmd).toContain('"rollback":"previous-release-restored"');
    expect(rollbackCmd).toContain('"workersStarted":false');
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

    expect(rollbackCmd).toContain("pm2 stop radar-v2");
    expect(rollbackCmd).not.toContain("pm2 startOrRestart");
    expect(rollbackCmd).not.toContain("pm2 restart");
    expect(rollbackCmd).not.toContain("CURRENT_SHA");
    expect(rollbackCmd).toContain('"rollback":"no-previous-release-web-stopped"');
    expect(rollbackCmd).toContain('"databaseRestored":false');
  });

  it("does not use a previous release for rollback if its verifier fails", () => {
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
        if (cmdStr.includes("CURRENT_SHA") && cmdStr.startsWith("if [ -f ")) return priorSha;
        // Prior release verification fails (e.g. exit non-zero from scripts/release/verify.ts)
        if (cmdStr.startsWith("if [ -d ") && cmdStr.includes(`releases/${priorSha}`))
          return "FAILED";
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

    // Rollback is treated as unavailable: web stopped, no activation of prior release
    expect(rollbackCmd).toContain("pm2 stop radar-v2");
    expect(rollbackCmd).not.toContain(`cd '/srv/radar/releases/${priorSha}'`);
    expect(rollbackCmd).not.toContain("pm2 startOrRestart");
    expect(rollbackCmd).not.toContain("CURRENT_SHA");
    expect(rollbackCmd).not.toContain('"rollback":"previous-release-restored"');
    expect(rollbackCmd).toContain('"rollback":"previous-release-unverified-web-stopped"');
    expect(rollbackCmd).toContain('"databaseRestored":false');
    expect(rollbackCmd).toContain('"workersStarted":false');
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
    const activationIndex = rollbackCmd.indexOf(
      "pm2 startOrRestart ecosystem.config.cjs --only radar-v2 --update-env",
    );
    const restoredReceiptIndex = rollbackCmd.indexOf('"rollback":"previous-release-restored"');

    // The initial receipt written before activation attempt must record rollback_failed
    expect(initialReceiptIndex).toBeGreaterThan(-1);
    expect(activationIndex).toBeGreaterThan(initialReceiptIndex);
    // previous-release-restored is strictly guarded inside the activation condition
    expect(restoredReceiptIndex).toBeGreaterThan(activationIndex);

    // If PM2 fails, the conditional subshell fails and else block stops radar-v2 without writing previous-release-restored
    expect(rollbackCmd).toContain("else\n  pm2 stop radar-v2 || true\nfi");
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
    // 2. pm2 startOrRestart
    // 3. CURRENT_SHA update
    // 4. previous-release-restored receipt written
    const cdIndex = rollbackCmd.indexOf(`cd '/srv/radar/releases/${priorSha}'`);
    const pm2Index = rollbackCmd.indexOf(
      "pm2 startOrRestart ecosystem.config.cjs --only radar-v2 --update-env",
    );
    const shaUpdateIndex = rollbackCmd.indexOf(
      `printf '%s' '${priorSha}' > '/srv/radar/CURRENT_SHA'`,
    );
    const successReceiptIndex = rollbackCmd.indexOf('"rollback":"previous-release-restored"');

    expect(cdIndex).toBeGreaterThan(-1);
    expect(pm2Index).toBeGreaterThan(cdIndex);
    expect(shaUpdateIndex).toBeGreaterThan(pm2Index);
    expect(successReceiptIndex).toBeGreaterThan(shaUpdateIndex);

    // Atomic subshell verifies all preconditions before success receipt is written
    expect(rollbackCmd).toContain(
      `if (cd '/srv/radar/releases/${priorSha}' && pm2 startOrRestart ecosystem.config.cjs --only radar-v2 --update-env && printf '%s' '${priorSha}' > '/srv/radar/CURRENT_SHA'); then`,
    );
  });
});
