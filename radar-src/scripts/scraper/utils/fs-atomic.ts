import fs from "fs";
import path from "path";

// Write-and-rename to survive mid-write crashes.
export function writeJsonAtomic(target: string, data: unknown): void {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}

export function readJsonSafe<T>(target: string): T | null {
  try {
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function fileAgeHours(target: string): number {
  try {
    const stat = fs.statSync(target);
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
