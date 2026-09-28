import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production runtime topology", () => {
  it("defines and verifies the explicitly supervised production topology", () => {
    const ecosystem = fs.readFileSync(path.resolve(process.cwd(), "ecosystem.config.cjs"), "utf8");
    for (const name of [
      "radar-v2",
      "radar-scrape",
      "radar-enrich",
      "radar-documents",
      "radar-evaluate",
      "radar-dossiers",
      "radar-reviews",
      "radar-corpus",
    ]) {
      expect(ecosystem).toContain(name);
    }
    const deploy = fs.readFileSync(path.resolve(process.cwd(), "scripts/deploy.ts"), "utf8");
    expect(deploy).toContain("const writers");
    expect(deploy).toContain("pm2 startOrRestart ecosystem.config.cjs --update-env");
    expect(deploy).toContain("verifyAllProcesses");
    expect(deploy).toContain("RADAR_DEPLOYMENT_MODE");
    expect(deploy).toContain("pm2 stop 'radar-scrape'");
  });
});
