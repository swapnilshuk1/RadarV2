import fs from "fs";
import path from "path";

// Append-only NDJSON journal, fsync'd after every write so a mid-run crash
// still leaves a durable record we can replay from.
export class Journal {
  private fd: number | null = null;
  private isClosed: boolean = false;

  constructor(private filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, "a");
    this.isClosed = false;
  }

  public isOpen(): boolean {
    return !this.isClosed && this.fd !== null;
  }

  append(event: Record<string, unknown>): void {
    if (this.isClosed || this.fd === null) {
      // Safe no-op: never attempt to write to a closed file descriptor post-finalization
      return;
    }
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
      fs.writeSync(this.fd, line);
      try { fs.fsyncSync(this.fd); } catch { /* fsync unsupported on some FS */ }
    } catch {
      // Handle any descriptor exceptions safely during process termination
    }
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.fd !== null) {
      const targetFd = this.fd;
      this.fd = null;
      try {
        fs.closeSync(targetFd);
      } catch {
        /* already closed */
      }
    }
  }

  static replay(filePath: string): Record<string, unknown>[] {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x): x is Record<string, unknown> => x !== null);
  }

  static readIncremental(filePath: string, afterIndex: number): { events: Record<string, unknown>[], nextIndex: number } {
    if (!fs.existsSync(filePath)) return { events: [], nextIndex: afterIndex };
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    const newLines = lines.slice(afterIndex);
    const events = newLines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x): x is Record<string, unknown> => x !== null);
    return { events, nextIndex: lines.length };
  }
}
