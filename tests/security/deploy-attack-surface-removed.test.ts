import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Checkpoint A: Deployment Attack Surface Removal Contract", () => {
  it("Invariant 1: Privileged deployment webhook endpoint is deleted", () => {
    const deployPath = path.resolve(process.cwd(), "src/routes/api/webhooks/deploy.ts");
    expect(fs.existsSync(deployPath)).toBe(false);
  });

  it("Invariant 2: Profile view contains zero deployment or rebuild triggers", () => {
    const profilePath = path.resolve(process.cwd(), "src/routes/profile.tsx");
    const content = fs.readFileSync(profilePath, "utf-8");

    // Zero references to deployment functions or button
    expect(content.includes("triggerDeployFn")).toBe(false);
    expect(content.includes("AUTO-PULL & REBUILD")).toBe(false);
    expect(content.includes("SYNC & REBUILD")).toBe(false);
    expect(content.includes("deploying")).toBe(false);
  });

  it("Invariant 3: Zero application code in src/ may execute host firewall or SSH tampering", () => {
    function scanDir(dir: string): string[] {
      const results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...scanDir(fullPath));
        } else if (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".mjs")) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const srcFiles = scanDir(path.resolve(process.cwd(), "src"));

    const prohibitedPatterns = [
      { name: "iptables flush", regex: /iptables\s+-F/i },
      { name: "ufw disable", regex: /ufw\s+disable/i },
      { name: "ssh authorized_keys modification", regex: /\.ssh\/authorized_keys/i },
      { name: "ssh service restart", regex: /systemctl\s+restart\s+ssh/i },
      { name: "hardcoded oracle ssh key", regex: /id_rsa_oracle/i },
      { name: "fallback deploy secret", regex: /radar-deploy-secret-2026/i },
    ];

    for (const filePath of srcFiles) {
      const code = fs.readFileSync(filePath, "utf-8");
      for (const pattern of prohibitedPatterns) {
        const matches = pattern.regex.test(code);
        if (matches) {
          const relPath = path.relative(process.cwd(), filePath);
          expect(matches, `Found prohibited pattern '${pattern.name}' in ${relPath}`).toBe(false);
        }
      }
    }
  });
});
