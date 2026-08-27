const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const JSZip = require("jszip");

async function createZip() {
  const rootDir = path.resolve(__dirname, "..");
  const filesOutput = cp.execSync("git ls-files --cached --others --exclude-standard", {
    cwd: rootDir,
    encoding: "utf8",
  });
  const fileList = filesOutput.split(/\r?\n/).filter(Boolean);

  console.log(`Adding ${fileList.length} files respecting .gitignore to zip archive...`);
  const zip = new JSZip();

  for (const relPath of fileList) {
    const fullPath = path.join(rootDir, relPath);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      if (stats.isFile()) {
        const content = fs.readFileSync(fullPath);
        zip.file(relPath.replace(/\\/g, "/"), content);
      }
    }
  }

  console.log("Compressing zip buffer...");
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const destPath = path.resolve(rootDir, "..", "radar-v2-git.zip");
  fs.writeFileSync(destPath, buffer);
  console.log(`Successfully created: ${destPath} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);

  const destPathInside = path.resolve(rootDir, "radar-v2-git.zip");
  fs.writeFileSync(destPathInside, buffer);
  console.log(`Also copied inside repo folder: ${destPathInside}`);
}

createZip().catch((err) => {
  console.error("Failed to create zip:", err);
  process.exit(1);
});
