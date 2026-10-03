import fs from "node:fs";
import path from "node:path";
import { testRegistry } from "./registry";

export function renderTestRegistry(): string {
  return [
    "## 3. Complete Test File Registry",
    "",
    "Generated from `scripts/certification/registry.ts` with `npm run tests:inventory`. Edit the registry, then regenerate this section.",
    "",
    "| Test file | Domain | Disposition | Test lanes | Certification domain |",
    "| --- | --- | --- | --- | --- |",
    ...testRegistry.map((entry) => {
      const lanes =
        [entry.standard && "standard", entry.full && "full", entry.regression && "regression"]
          .filter(Boolean)
          .join(", ") || "manual live audit";
      return `| \`${entry.file}\` | ${entry.domain} | **${entry.disposition}** | ${lanes} | ${entry.certificationGroup ?? "outside certification"} |`;
    }),
    "",
  ].join("\n");
}

export function updateInventory(content: string): string {
  const start = content.indexOf("## 3. Complete Test File Registry");
  const end = content.indexOf("## 4.", start);
  if (start < 0 || end < 0) throw new Error("TEST_INVENTORY_SECTION_MISSING");
  return content.slice(0, start) + renderTestRegistry() + "\n" + content.slice(end);
}

if (process.argv[1]?.endsWith("inventory.ts")) {
  const file = path.resolve("tests/TEST_INVENTORY.md");
  const current = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const next = updateInventory(current);
  if (process.argv.includes("--write")) fs.writeFileSync(file, next);
  else if (next !== current) throw new Error("TEST_INVENTORY_DRIFT: run npm run tests:inventory");
}
