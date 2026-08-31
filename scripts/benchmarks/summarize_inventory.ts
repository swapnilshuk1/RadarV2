import fs from "fs";

const data = JSON.parse(fs.readFileSync("scripts-and-tests-inventory.json", "utf-8"));

console.log("=== TESTS BREAKDOWN ===");
console.log("Total Test Files:", data.totalTests);
console.log("Archive Tests (historical phases):", data.testCategories.archive.length);
console.log("Editorial Tests:", data.testCategories.editorial.length);
console.log("Intelligence Tests:", data.testCategories.intelligence.length);
console.log("Acquisition Tests:", data.testCategories.acquisition.length);
console.log("Other Tests:", data.testCategories.other.length);

console.log("\n--- Other Tests List ---");
data.testCategories.other.forEach((t: any) => console.log(` - ${t.relPath} (${t.lines} lines, ${t.describeBlocks.join(" | ")})`));

console.log("\n--- Intelligence Tests Sample (First 20) ---");
data.testCategories.intelligence.slice(0, 20).forEach((t: any) => console.log(` - ${t.relPath} (Turso: ${t.hasTurso}, BetterSqlite: ${t.hasBetterSqlite}, Lines: ${t.lines})`));

console.log("\n=== SCRIPTS BREAKDOWN ===");
console.log("Total Scripts:", data.totalScripts);

const scriptDirs: Record<string, number> = {};
data.scripts.forEach((s: any) => {
  const topDir = s.relPath.split("/").slice(0, 2).join("/");
  scriptDirs[topDir] = (scriptDirs[topDir] || 0) + 1;
});
console.log("Scripts by Directory:", JSON.stringify(scriptDirs, null, 2));
