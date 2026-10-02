import fs from "fs";
import path from "path";

// Write-and-rename to survive mid-write crashes.
export function writeJsonAtomic(target: string, data: unknown): void {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Add a random suffix to avoid any chance of tmp file collision
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // Windows frequently throws EPERM on renameSync if antivirus is scanning
  // the tmp file or if another process briefly locked the target.
  let retries = 20;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  while (retries > 0) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (e: any) {
      if (e.code === "EPERM" || e.code === "EACCES" || e.code === "EBUSY") {
        retries--;
        if (retries === 0) {
          // Preserve both the last good target and the fsynced replacement for recovery.
          throw e;
        }
        // Bounded 3.8-second window without burning CPU while another process
        // releases its handle. This remains below the execution lease interval.
        Atomics.wait(wait, 0, 0, Math.min(250, (20 - retries) * 25));
      } else {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
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
