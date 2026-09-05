import { execSync } from "child_process";
import path from "path";
import fs from "fs";

/**
 * RADAR v2 Production Deployment Pipeline
 * 
 * Target: Oracle Cloud VM (130.210.41.232 / http://130.210.41.232.sslip.io/)
 * SSH Key: C:\Users\swapn\.ssh\oracle_official.key
 * User: ubuntu
 * Directory: /home/ubuntu/radar-local-v2
 * PM2 Process: radar-v2
 */

const SSH_KEY = path.resolve(process.env.USERPROFILE || process.env.HOME || "", ".ssh", "oracle_official.key");
const REMOTE_HOST = "ubuntu@130.210.41.232";
const REMOTE_DIR = "/home/ubuntu/radar-local-v2";

function run(cmd: string, cwd = process.cwd()) {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { cwd, stdio: "inherit" });
}

async function deploy() {
  console.log("============================================================");
  console.log("       RADAR V2 — ORACLE CLOUD AUTOMATED DEPLOYMENT         ");
  console.log("============================================================\n");
  console.log(`Target Host  : ${REMOTE_HOST}`);
  console.log(`SSH Key      : ${SSH_KEY}`);
  console.log(`Remote Path  : ${REMOTE_DIR}`);
  console.log(`Live Service : http://130.210.41.232.sslip.io/`);
  console.log("────────────────────────────────────────────────────────────\n");

  if (!fs.existsSync(SSH_KEY)) {
    throw new Error(`SSH private key not found at: ${SSH_KEY}`);
  }

  // 1. Local Verification
  console.log("[1/4] Running local TypeScript typecheck...");
  run("npx tsc --noEmit");

  console.log("\n[2/4] Running local production build verification...");
  run("npm run build");

  // 2. Git Status and Push
  console.log("\n[3/4] Checking and pushing Git changes to origin/main...");
  try {
    const status = execSync("git status --porcelain").toString();
    if (status.trim()) {
      console.log("Staging and committing local changes...");
      run("git add .");
      const commitMsg = process.argv[2] || `Deploy update: ${new Date().toISOString()}`;
      run(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    } else {
      console.log("Working tree clean. Nothing to commit locally.");
    }
  } catch (e: any) {
    console.log("Git commit notice:", e.message);
  }

  run("git push origin main");

  // 3. Remote Pull, Build, and PM2 Restart
  console.log("\n[4/4] Deploying to Oracle Cloud Server via SSH...");
  const remoteCmds = [
    `cd ${REMOTE_DIR}`,
    `git fetch origin main`,
    `git reset --hard origin/main`,
    `npm install`,
    `npm run db:migrate`,
    `npm run build`,
    `pm2 restart radar-v2`,
    `pm2 status`
  ].join(" && ");

  const sshCmd = `ssh -o StrictHostKeyChecking=no -i "${SSH_KEY}" ${REMOTE_HOST} "${remoteCmds}"`;
  run(sshCmd);

  console.log("\n============================================================");
  console.log("      DEPLOYMENT COMPLETE — SERVER RUNNING SUCCESSFULLY     ");
  console.log("      Live URL: http://130.210.41.232.sslip.io/             ");
  console.log("============================================================\n");
}

deploy().catch(err => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});
