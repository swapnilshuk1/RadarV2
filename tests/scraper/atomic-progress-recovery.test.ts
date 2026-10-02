import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomic } from "../../scripts/scraper/utils/fs-atomic";
import { pool } from "../../scripts/scraper/utils/concurrency";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});

describe("Atomic progress recovery", () => {
  it("survives a Windows lock longer than the former ten-attempt budget", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-atomic-"));
    directories.push(directory);
    const target = path.join(directory, "manifest.json");
    fs.writeFileSync(target, '{"count":1}');
    const rename = fs.renameSync.bind(fs);
    let attempts = 0;
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (++attempts <= 12) throw Object.assign(new Error("locked"), { code: "EPERM" });
      rename(from, to);
    });
    writeJsonAtomic(target, { count: 2 });
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ count: 2 });
    expect(attempts).toBe(13);
    expect(fs.readdirSync(directory)).toEqual(["manifest.json"]);
  });

  it("retains the last good manifest and complete replacement after persistent contention", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-atomic-"));
    directories.push(directory);
    const target = path.join(directory, "manifest.json");
    fs.writeFileSync(target, '{"count":1}');
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("locked"), { code: "EBUSY" });
    });
    expect(() => writeJsonAtomic(target, { count: 2 })).toThrow("locked");
    expect(rename).toHaveBeenCalledTimes(20);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ count: 1 });
    const temporary = fs.readdirSync(directory).find((name) => name.includes(".tmp-"))!;
    expect(JSON.parse(fs.readFileSync(path.join(directory, temporary), "utf8"))).toEqual({
      count: 2,
    });
  });

  it("does not close the pool while a portal is finishing after the error callback fails", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    let secondFinished = false;
    const completion = pool(
      ["LinkedIn", "Naukri"],
      2,
      async (portal) => {
        if (portal === "LinkedIn") throw new Error("portal failure");
        await waiting;
        secondFinished = true;
      },
      () => {
        throw new Error("manifest locked");
      },
    );
    const observed = completion.catch((error) => {
      settled = true;
      return error;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    expect((await observed).message).toBe("manifest locked");
    expect(secondFinished).toBe(true);
  });
});
