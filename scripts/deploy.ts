import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sshKey = path.resolve(process.env.USERPROFILE || process.env.HOME || "", ".ssh", "oracle_official.key");
const remoteHost = "ubuntu@161.118.175.246";
const remoteDir = "/home/ubuntu/radar-local-v2";
const sha = process.argv[2];

function run(command: string, args: string[]) { console.log(`> ${command} ${args.join(" ")}`); return execFileSync(command, args, { stdio: "inherit" }); }
function output(command: string, args: string[]) { return execFileSync(command, args, { encoding: "utf8" }).trim(); }

async function deploy() {
  if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error("Usage: npm run deploy -- <approved-commit-sha>");
  if (!fs.existsSync(sshKey)) throw new Error(`SSH private key not found: ${sshKey}`);
  if (output("git", ["status", "--porcelain"])) throw new Error("Refusing deployment from a dirty worktree.");
  const exactSha = output("git", ["rev-parse", "--verify", `${sha}^{commit}`]);
  if (output("git", ["rev-parse", "HEAD"]) !== exactSha) throw new Error("Checkout the approved SHA locally before deployment.");
  run("npm", ["run", "build"]);
  run("npm", ["run", "db:status"]);
  const remote = ["set -eu", `cd ${remoteDir}`, "git fetch --all --tags --prune", `git checkout --detach ${exactSha}`, "test -z \"$(git status --porcelain)\"", "npm ci", "npm run build", "npm run db:status", "pm2 stop radar-v2 || true", "pm2 stop radar-enrich || true", "pm2 stop radar-evaluate || true", "pm2 stop radar-documents || true", "npm run db:migrate", "pm2 startOrRestart ecosystem.config.cjs --only radar-v2", "for i in $(seq 1 30); do curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null && break; sleep 1; done", "curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null", "pm2 save", "echo 'Web started; workers remain stopped pending explicit operator approval.'"].join(" && ");
  run("ssh", ["-o", "StrictHostKeyChecking=yes", "-i", sshKey, remoteHost, remote]);
}
deploy().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
