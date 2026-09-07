/**
 * tests/serving/cursor.test.ts
 *
 * RADAR v2 — Opaque Keyset Cursor Test Suite (Phase 3 Certification).
 *
 * Verifies:
 * 1. Opaque wire format: starts with 'v1:' and encodes keyset position.
 * 2. Deterministic round-trip encoding and decoding.
 * 3. Null score handling for unmaterialized/sparse opportunities.
 * 4. Boundary enforcement (tiers 0-5, scores 0-100).
 * 5. Rejection of corrupted, forged, tampered, or wrong-version cursor tokens.
 */

import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  CursorValidationError,
  type KeysetPosition,
} from "../../src/lib/intelligence/cursor";

describe("Phase 3: Opaque Keyset Cursor Engine", () => {
  describe("1. Encoding & Opaque Wire Format", () => {
    it("encodes valid keyset position with v1: prefix and base64url payload", () => {
      const pos: KeysetPosition = {
        tier: 0,
        score: 94.5,
        jobHash: "j-008f74870e2a",
      };

      const cursor = encodeCursor(pos);
      expect(typeof cursor).toBe("string");
      expect(cursor.startsWith("v1:")).toBe(true);
      
      // Wire token must not expose raw key names in plain text
      expect(cursor).not.toContain("tier");
      expect(cursor).not.toContain("jobHash");
    });

    it("encodes position with null score", () => {
      const pos: KeysetPosition = {
        tier: 4,
        score: null,
        jobHash: "j-sparse-123",
      };

      const cursor = encodeCursor(pos);
      expect(cursor.startsWith("v1:")).toBe(true);
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual({
        tier: 4,
        score: null,
        jobHash: "j-sparse-123",
      });
    });

    it("round-trips a server-supplied feed filter signature without exposing filter semantics", () => {
      const cursor = encodeCursor({
        tier: 0,
        score: 95,
        jobHash: "job-filter-bound",
        filterSignature: '{"categoryId":"all","decisionFilter":"all","shortlistQueue":false}',
      });
      expect(decodeCursor(cursor)?.filterSignature).toBe('{"categoryId":"all","decisionFilter":"all","shortlistQueue":false}');
    });

    it("preserves score precision to 2 decimal places", () => {
      const pos: KeysetPosition = {
        tier: 1,
        score: 87.654321,
        jobHash: "j-precision-test",
      };

      const cursor = encodeCursor(pos);
      const decoded = decodeCursor(cursor);
      expect(decoded?.score).toBe(87.65);
    });
  });

  describe("2. Deterministic Round-Trip Verification", () => {
    const testCases: KeysetPosition[] = [
      { tier: 0, score: 100, jobHash: "j-tier0-max" },
      { tier: 0, score: 0, jobHash: "j-tier0-zero" },
      { tier: 1, score: 75.5, jobHash: "j-tier1-mid" },
      { tier: 2, score: 62.1, jobHash: "j-tier2-veto" },
      { tier: 3, score: 50.0, jobHash: "j-tier3-consider" },
      { tier: 4, score: null, jobHash: "j-tier4-sparse" },
      { tier: 5, score: 10.0, jobHash: "j-tier5-pass" },
      { tier: 5, score: null, jobHash: "j-tier5-unmat" },
    ];

    for (const pos of testCases) {
      it(`round-trips tier=${pos.tier}, score=${pos.score}, hash=${pos.jobHash}`, () => {
        const encoded = encodeCursor(pos);
        const decoded = decodeCursor(encoded);
        expect(decoded).toEqual(pos);
      });
    }
  });

  describe("3. Null & Empty Cursor Handling (Page 1 Request)", () => {
    it("returns null for null cursor", () => {
      expect(decodeCursor(null)).toBeNull();
    });

    it("returns null for undefined cursor", () => {
      expect(decodeCursor(undefined)).toBeNull();
    });

    it("returns null for empty string cursor", () => {
      expect(decodeCursor("")).toBeNull();
      expect(decodeCursor("   ")).toBeNull();
    });
  });

  describe("4. Encoder Boundary & Validation Guards", () => {
    it("rejects negative tiers", () => {
      expect(() => encodeCursor({ tier: -1, score: 90, jobHash: "j-1" })).toThrow(CursorValidationError);
    });

    it("rejects tiers greater than 5", () => {
      expect(() => encodeCursor({ tier: 6, score: 90, jobHash: "j-1" })).toThrow(CursorValidationError);
    });

    it("rejects non-integer tiers", () => {
      expect(() => encodeCursor({ tier: 2.5, score: 90, jobHash: "j-1" })).toThrow(CursorValidationError);
    });

    it("rejects scores below 0", () => {
      expect(() => encodeCursor({ tier: 0, score: -1, jobHash: "j-1" })).toThrow(CursorValidationError);
    });

    it("rejects scores above 100", () => {
      expect(() => encodeCursor({ tier: 0, score: 101, jobHash: "j-1" })).toThrow(CursorValidationError);
    });

    it("rejects NaN score", () => {
      expect(() => encodeCursor({ tier: 0, score: NaN, jobHash: "j-1" })).toThrow(CursorValidationError);
    });

    it("rejects empty or whitespace jobHash", () => {
      expect(() => encodeCursor({ tier: 0, score: 90, jobHash: "" })).toThrow(CursorValidationError);
      expect(() => encodeCursor({ tier: 0, score: 90, jobHash: "   " })).toThrow(CursorValidationError);
    });

    it("rejects jobHash with invalid characters", () => {
      expect(() => encodeCursor({ tier: 0, score: 90, jobHash: "j-123; DROP TABLE" })).toThrow(CursorValidationError);
      expect(() => encodeCursor({ tier: 0, score: 90, jobHash: "j 123" })).toThrow(CursorValidationError);
    });
  });

  describe("5. Decoder Tamper & Corruption Resistance", () => {
    it("rejects cursor with wrong version prefix (e.g. v2:)", () => {
      expect(() => decodeCursor("v2:eyJ0IjowLCJzIjo5MCwiaCI6ImoiLCJwb3MiOjB9")).toThrow(CursorValidationError);
    });

    it("rejects cursor with missing version prefix", () => {
      expect(() => decodeCursor("eyJ0IjowLCJzIjo5MCwiaCI6ImoiLCJwb3MiOjB9")).toThrow(CursorValidationError);
    });

    it("rejects cursor with empty payload after prefix", () => {
      expect(() => decodeCursor("v1:")).toThrow(CursorValidationError);
    });

    it("rejects cursor with corrupted base64url payload", () => {
      expect(() => decodeCursor("v1:!@#$not-valid-base64%^&*")).toThrow(CursorValidationError);
    });

    it("rejects cursor with non-JSON decoded payload", () => {
      const invalidJsonBase64 = Buffer.from("this is plain text not json").toString("base64url");
      expect(() => decodeCursor(`v1:${invalidJsonBase64}`)).toThrow(CursorValidationError);
    });

    it("rejects cursor with non-object JSON (e.g. array or primitive)", () => {
      const arrayBase64 = Buffer.from("[1, 2, 3]").toString("base64url");
      expect(() => decodeCursor(`v1:${arrayBase64}`)).toThrow(CursorValidationError);
    });

    it("rejects cursor with forged tier out of range", () => {
      const forgedTierBase64 = Buffer.from(JSON.stringify({ t: 99, s: 50, h: "j-1" })).toString("base64url");
      expect(() => decodeCursor(`v1:${forgedTierBase64}`)).toThrow(CursorValidationError);
    });

    it("rejects cursor with forged score out of range", () => {
      const forgedScoreBase64 = Buffer.from(JSON.stringify({ t: 0, s: 999, h: "j-1" })).toString("base64url");
      expect(() => decodeCursor(`v1:${forgedScoreBase64}`)).toThrow(CursorValidationError);
    });

    it("rejects cursor with forged empty or invalid jobHash", () => {
      const forgedHashBase64 = Buffer.from(JSON.stringify({ t: 0, s: 50, h: "" })).toString("base64url");
      expect(() => decodeCursor(`v1:${forgedHashBase64}`)).toThrow(CursorValidationError);
    });
  });
});
