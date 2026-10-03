import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runtimeInputChecksum } from "./payload";

export function runtimeChanged(current: string, deployed: unknown): boolean {
  const receipt = deployed as { status?: unknown; runtimeInputSha256?: unknown } | null;
  return (
    receipt?.status !== "ready" ||
    typeof receipt.runtimeInputSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.runtimeInputSha256) ||
    receipt.runtimeInputSha256 !== current
  );
}

if (process.argv[1]?.endsWith("runtime-input.ts")) {
  const root = process.cwd();
  const runtimeInputSha256 = runtimeInputChecksum(root);
  let deployed: unknown = null;
  try {
    deployed = JSON.parse(
      fs.readFileSync(process.argv[2] ?? ".radar/deployed-runtime.json", "utf8"),
    );
  } catch {
    /* No trusted deployed receipt means package conservatively. */
  }
  const changed = runtimeChanged(runtimeInputSha256, deployed);
  const receipt = {
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    runtimeInputSha256,
  };
  fs.mkdirSync(path.join(root, ".radar"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".radar/release-input.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${changed}\nruntime_digest=${runtimeInputSha256}\n`,
    );
  console.log(
    changed
      ? "Runtime inputs differ from the deployed receipt; package a release."
      : "Runtime inputs match the deployed receipt; packaging and deployment skipped.",
  );
}
