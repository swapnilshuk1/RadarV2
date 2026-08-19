import fs from "fs";
import path from "path";

interface Entry {
  sourceFile: string;
  targetPath: string;
  disposition: string;
  domain: string;
}

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "tests", "test-inventory.json");
const manifest: Entry[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

console.log(`Starting migration of ${manifest.length} test suites...`);

for (const item of manifest) {
  const src = path.join(rootDir, item.sourceFile);
  const dest = path.join(rootDir, item.targetPath);

  if (!fs.existsSync(src)) {
    console.warn(`Source not found: ${item.sourceFile}`);
    continue;
  }

  // Ensure target directory exists
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Read content to adjust relative import paths if folder depth changed
  let content = fs.readFileSync(src, "utf8");

  const srcDepth = item.sourceFile.split("/").length - 1; // e.g. tests/foo.test.ts -> depth 1
  const destDepth = item.targetPath.split("/").length - 1; // e.g. tests/domain/foo.test.ts -> depth 2

  if (destDepth > srcDepth) {
    // Need one more ../ for relative imports pointing to ../src or ../data
    content = content.replace(/from\s+["']\.\.\/src\//g, 'from "../../src/');
    content = content.replace(/from\s+["']\.\.\/data\//g, 'from "../../data/');
    content = content.replace(/from\s+["']\.\.\/tests\//g, 'from "../../tests/');
  } else if (destDepth < srcDepth) {
    // Need one less ../
    content = content.replace(/from\s+["']\.\.\/\.\.\/src\//g, 'from "../src/');
    content = content.replace(/from\s+["']\.\.\/\.\.\/data\//g, 'from "../data/');
  }

  fs.writeFileSync(dest, content, "utf8");

  // Remove source if source and dest are different
  if (path.resolve(src) !== path.resolve(dest)) {
    fs.unlinkSync(src);
  }

  console.log(`[${item.disposition}] ${item.sourceFile} -> ${item.targetPath}`);
}

console.log("\nAll files successfully organized.");
