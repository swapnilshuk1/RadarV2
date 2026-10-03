import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { load as loadYaml } from "js-yaml";
import { releasePayloadChecksum } from "../../scripts/release/package";
import { verifyReleaseDirectory } from "../../scripts/release/verify";

type WorkflowStep = {
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
};

type CiWorkflow = {
  on: {
    push: { branches: string[] };
    pull_request: { branches: string[] };
  };
  concurrency: {
    group: string;
    "cancel-in-progress": string;
  };
  jobs: { verify: { steps: WorkflowStep[] } };
};

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

  function ciWorkflow(): CiWorkflow {
    const workflowPath = path.resolve(process.cwd(), ".github/workflows/ci.yml");
    return loadYaml(fs.readFileSync(workflowPath, "utf8")) as CiWorkflow;
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

  it("runs cancellable PR feedback and keeps authoritative main runs uncancelled", () => {
    const workflow = ciWorkflow();
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.pull_request.branches).toEqual(["main"]);
    expect(workflow.concurrency.group).toContain("github.event.pull_request.number");
    expect(workflow.concurrency.group).toContain("github.run_id");
    expect(workflow.concurrency["cancel-in-progress"]).toContain(
      "github.event_name == 'pull_request'",
    );

    const checkout = workflow.jobs.verify.steps.find((step) => step.uses === "actions/checkout@v4");
    expect(checkout?.with?.["fetch-depth"]).toBe(0);

    const feedback = workflow.jobs.verify.steps.find(
      (step) => step.name === "Pull request release feedback",
    );
    expect(feedback?.if).toBe("${{ github.event_name == 'pull_request' }}");
    expect(feedback?.run).toBe("npm run certify:feedback");
    expect(feedback?.env?.CERTIFY_AFFECTED_BASE).toBe("${{ github.event.pull_request.base.sha }}");
  });

  it("certifies and publishes release artifacts only on main after full certification", () => {
    const steps = ciWorkflow().jobs.verify.steps;
    const mainOnly = "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}";
    const mainCertification = steps.find(
      (step) => step.name === "Authoritative main release certification",
    );
    const packageRelease = steps.find(
      (step) => step.name === "Package exact certified release artifact",
    );
    const verifyPortability = steps.find(
      (step) => step.name === "Verify extracted release portability",
    );
    const retainArtifact = steps.find(
      (step) => step.name === "Retain release artifact for this exact commit",
    );

    expect(mainCertification?.if).toBe(mainOnly);
    expect(mainCertification?.run).toBe("npm run certify");
    expect(packageRelease?.if).toBe(mainOnly);
    expect(verifyPortability?.if).toBe(mainOnly);
    expect(retainArtifact?.if).toBe(mainOnly);
    for (const step of [mainCertification, packageRelease, verifyPortability, retainArtifact]) {
      expect(step?.["continue-on-error"]).not.toBe(true);
      expect(step?.if).not.toMatch(/\b(always|failure|cancelled)\s*\(/i);
    }
    expect(steps.indexOf(mainCertification!)).toBeLessThan(steps.indexOf(packageRelease!));
    expect(steps.indexOf(packageRelease!)).toBeLessThan(steps.indexOf(verifyPortability!));
    expect(steps.indexOf(verifyPortability!)).toBeLessThan(steps.indexOf(retainArtifact!));
  });
});
