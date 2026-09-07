import { describe, expect, test } from "vitest";
import { isLocalOAuthHost, resolveGoogleCallbackUrl, shouldUseSecureOAuthCookie } from "../../src/lib/auth/oauth-callback-url";

describe("Google OAuth callback URL policy", () => {
  test("permits only derived HTTP callbacks on localhost", () => {
    expect(resolveGoogleCallbackUrl("localhost:3000", undefined)).toBe("http://localhost:3000/api/auth/callback");
    expect(resolveGoogleCallbackUrl("127.0.0.1:3000", undefined)).toBe("http://127.0.0.1:3000/api/auth/callback");
    expect(resolveGoogleCallbackUrl("[::1]:3000", undefined)).toBe("http://[::1]:3000/api/auth/callback");
  });

  test("recognizes only exact local hostnames and shares that decision with cookie security", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(isLocalOAuthHost(host)).toBe(true);
      expect(shouldUseSecureOAuthCookie(host)).toBe(false);
    }
    for (const host of ["localhost.evil.example", "localhost-attacker.example", "127.0.0.1.evil.example", "radar.example"]) {
      expect(isLocalOAuthHost(host)).toBe(false);
      expect(shouldUseSecureOAuthCookie(host)).toBe(true);
      expect(() => resolveGoogleCallbackUrl(host, undefined)).toThrow("GOOGLE_REDIRECT_URI is required");
    }
  });

  test("requires an explicit HTTPS URL outside localhost", () => {
    expect(() => resolveGoogleCallbackUrl("radar.example", undefined)).toThrow("GOOGLE_REDIRECT_URI is required");
    expect(() => resolveGoogleCallbackUrl("radar.example", "http://radar.example/api/auth/callback")).toThrow("must use HTTPS");
    expect(resolveGoogleCallbackUrl("radar.example", "https://radar.example/api/auth/callback")).toBe("https://radar.example/api/auth/callback");
  });
});
