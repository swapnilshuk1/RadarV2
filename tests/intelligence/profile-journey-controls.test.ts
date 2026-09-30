import { describe, expect, it } from "vitest";
import { canReopenPursuit } from "../../src/lib/intelligence/pursuit-affordance";
import { profilePollDelay, shouldPollProfile } from "@/candidate/presentation";

describe("Profile and dossier journey controls", () => {
  it("shows a reopen action only after the candidate chose PURSUE", () => {
    expect(canReopenPursuit(null)).toBe(false);
    expect(canReopenPursuit("NONE")).toBe(false);
    expect(canReopenPursuit("CONSIDER")).toBe(false);
    expect(canReopenPursuit("PASS")).toBe(false);
    expect(canReopenPursuit("PURSUE")).toBe(true);
  });

  it("backs off Profile status reads and caps the interval", () => {
    expect(profilePollDelay(0)).toBe(1200);
    expect(profilePollDelay(3)).toBeGreaterThan(profilePollDelay(0));
    expect(profilePollDelay(300)).toBe(30_000);
  });

  it("suppresses hidden and terminal status polling", () => {
    expect(shouldPollProfile("PROCESSING", true)).toBe(true);
    expect(shouldPollProfile("PROCESSING", false)).toBe(false);
    expect(shouldPollProfile("COMPLETED", true)).toBe(false);
    expect(shouldPollProfile("FAILED", true)).toBe(false);
  });
});
