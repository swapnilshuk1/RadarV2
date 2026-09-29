import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("production runtime topology", () => {
  it("starts the server scraper only with explicit opt-in", () => {
    const names = (enabled: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "-e",
            "console.log(JSON.stringify(require('./ecosystem.config.cjs').apps.map(app => app.name)))",
          ],
          {
            cwd: process.cwd(),
            env: { ...process.env, RADAR_SERVER_SCRAPER_ENABLED: enabled },
            encoding: "utf8",
          },
        ),
      ) as string[];
    expect(names("false")).not.toContain("radar-scrape");
    expect(names("true")).toContain("radar-scrape");
  });

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
