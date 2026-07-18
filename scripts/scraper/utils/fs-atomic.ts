import fs from "fs";
import path from "path";

// Write-and-rename to survive mid-write crashes.
export function writeJsonAtomic(target: string, data: unknown): void {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Add a random suffix to avoid any chance of tmp file collision
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");

  // Windows frequently throws EPERM on renameSync if antivirus is scanning
  // the tmp file or if another process briefly locked the target.
  let retries = 10;
  while (retries > 0) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (e: any) {
      if (e.code === "EPERM" || e.code === "EACCES") {
        retries--;
        if (retries === 0) throw e;
        // Busy-wait 50ms to allow the lock to release (sync context)
        const start = Date.now();
        while (Date.now() - start < 50) { /* wait */ }
      } else {
        throw e;
      }
    }
  }
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
