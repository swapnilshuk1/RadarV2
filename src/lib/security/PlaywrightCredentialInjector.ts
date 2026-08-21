import type { BrowserContext } from "playwright";

/**
 * Custom security errors for Playwright credential injection.
 */
export class CredentialPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialPayloadError";
  }
}

export class CredentialDomainSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialDomainSecurityError";
  }
}

export class CredentialHeaderSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialHeaderSecurityError";
  }
}

/**
 * Single Authoritative Portal Domain Policy.
 */
export interface PortalDomainPolicy {
  readonly registrableDomain: string;
  readonly defaultCookieDomain: string;
  readonly canonicalDomains: readonly string[];
}

export const PORTAL_POLICY: Record<string, PortalDomainPolicy> = {
  linkedin: {
    registrableDomain: "linkedin.com",
    defaultCookieDomain: ".linkedin.com",
    canonicalDomains: [".linkedin.com", "linkedin.com", "www.linkedin.com"],
  },
  naukri: {
    registrableDomain: "naukri.com",
    defaultCookieDomain: ".naukri.com",
    canonicalDomains: [".naukri.com", "naukri.com", "www.naukri.com"],
  },
  indeed: {
    registrableDomain: "indeed.com",
    defaultCookieDomain: ".indeed.com",
    canonicalDomains: [".indeed.com", "indeed.com", "www.indeed.com"],
  },
} as const;

export const PORTAL_REGISTRABLE_DOMAINS: Record<string, string> = {
  linkedin: PORTAL_POLICY.linkedin.registrableDomain,
  naukri: PORTAL_POLICY.naukri.registrableDomain,
  indeed: PORTAL_POLICY.indeed.registrableDomain,
};

export const PORTAL_DOMAINS: Record<string, readonly string[]> = {
  linkedin: PORTAL_POLICY.linkedin.canonicalDomains,
  naukri: PORTAL_POLICY.naukri.canonicalDomains,
  indeed: PORTAL_POLICY.indeed.canonicalDomains,
};

export const PORTAL_DEFAULT_DOMAINS: Record<string, string> = {
  linkedin: PORTAL_POLICY.linkedin.defaultCookieDomain,
  naukri: PORTAL_POLICY.naukri.defaultCookieDomain,
  indeed: PORTAL_POLICY.indeed.defaultCookieDomain,
};

/**
 * Forbidden browser-controlled, transport, and diagnostic headers.
 * Under no circumstance may these headers be injected as extraHTTPHeaders.
 * In particular, 'cookie' is strictly forbidden to prevent bypassing cookie domain validation.
 */
const FORBIDDEN_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "host",
  "content-length",
  "connection",
  "proxy-authorization",
  "proxy-authenticate",
  "upgrade-insecure-requests",
  "accept-encoding",
  "te",
  "trailer",
  "transfer-encoding",
  ":authority",
  ":method",
  ":path",
  ":scheme",
]);

export interface ValidatedPlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
}

export interface ValidatedInjectionPayload {
  cookies: ValidatedPlaywrightCookie[];
  headers: Record<string, string>;
}

export class PlaywrightCredentialInjector {
  /**
   * Validates if a domain strictly matches the portal's registrable domain boundary
   * or trusted subdomains (e.g., 'linkedin.com', '.linkedin.com', 'www.linkedin.com', 'in.linkedin.com').
   *
   * Hard Invariant:
   * Rejects suffix spoofing (e.g., '.evil-linkedin.com', 'linkedin.com.evil.com'),
   * untrusted domains, and invalid URL characters (ports, paths, userInfo).
   */
  public static isPermittedDomain(portal: string, domain: string): boolean {
    const cleanPortal = portal.toLowerCase().trim();
    const policy = PORTAL_POLICY[cleanPortal];
    if (!policy) return false;

    const normalized = domain.toLowerCase().trim();
    if (!normalized) return false;

    // Reject domains with port, path, or user-info tampering
    if (
      normalized.includes("/") ||
      normalized.includes(":") ||
      normalized.includes("@") ||
      normalized.includes("\\")
    ) {
      return false;
    }

    // Strip leading dot for hostname evaluation (e.g. ".linkedin.com" -> "linkedin.com")
    const hostname = normalized.startsWith(".") ? normalized.slice(1) : normalized;
    if (!hostname) return false;

    // Reject empty subdomain segments or trailing dots (e.g. "..linkedin.com" or "linkedin.com.")
    if (hostname.includes("..") || hostname.endsWith(".")) {
      return false;
    }

    // Exact match with registrable domain (e.g. "linkedin.com")
    if (hostname === policy.registrableDomain) {
      return true;
    }

    // Trusted subdomain rooted at registrable domain (e.g. "www.linkedin.com", "in.linkedin.com")
    if (hostname.endsWith("." + policy.registrableDomain)) {
      return true;
    }

    return false;
  }

  /**
   * Canonical fail-closed parser for credential payloads.
   * Validates the ENTIRE payload (cookies, domains, headers) before returning.
   * Throws on any ambiguity or malformed input.
   */
  public static parseAndValidate(
    portal: string,
    secretPayload: string
  ): ValidatedInjectionPayload {
    const cleanPortal = portal.toLowerCase().trim();
    const policy = PORTAL_POLICY[cleanPortal];
    if (!policy) {
      throw new CredentialDomainSecurityError(
        `Unsupported portal '${portal}'. No canonical domain policy registered.`
      );
    }

    if (typeof secretPayload !== "string" || secretPayload.trim().length === 0) {
      throw new CredentialPayloadError("Credential payload must be a non-empty string");
    }

    const trimmed = secretPayload.trim();
    const defaultDomain = policy.defaultCookieDomain;

    const result: ValidatedInjectionPayload = {
      cookies: [],
      headers: {},
    };

    // Attempt JSON parsing first
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err: any) {
        throw new CredentialPayloadError(`Malformed JSON credential payload: ${err.message}`);
      }

      if (parsed === null || typeof parsed !== "object") {
        throw new CredentialPayloadError("Credential payload must evaluate to a valid object or array");
      }

      // Case 1: Cookie array -> [ { name, value, ... } ]
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          throw new CredentialPayloadError("Cookie array payload cannot be empty");
        }
        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new CredentialPayloadError(`Cookie item at index ${i} must be an object`);
          }
          const cookie = this.normalizeAndValidateCookieItem(cleanPortal, item, defaultDomain, i);
          result.cookies.push(cookie);
        }
        return result;
      }

      const obj = parsed as Record<string, unknown>;

      // Case 2: Explicit { headers: { ... } }
      if ("headers" in obj) {
        const headersVal = obj.headers;
        if (!headersVal || typeof headersVal !== "object" || Array.isArray(headersVal)) {
          throw new CredentialPayloadError("Field 'headers' must be an object mapping header names to string values");
        }
        const headerEntries = Object.entries(headersVal as Record<string, unknown>);
        if (headerEntries.length === 0) {
          throw new CredentialPayloadError("Field 'headers' cannot be empty");
        }
        for (const [key, value] of headerEntries) {
          this.validateHeaderEntry(key, value, result.headers);
        }
        // If there are other top-level keys in a header payload, reject ambiguity
        const extraKeys = Object.keys(obj).filter((k) => k !== "headers");
        if (extraKeys.length > 0) {
          throw new CredentialPayloadError(
            `Ambiguous credential payload: cannot mix 'headers' with other top-level fields (${extraKeys.join(", ")})`
          );
        }
        return result;
      }

      // Case 3: Explicit { cookies: [ ... ] }
      if ("cookies" in obj) {
        const cookiesVal = obj.cookies;
        if (!Array.isArray(cookiesVal) || cookiesVal.length === 0) {
          throw new CredentialPayloadError("Field 'cookies' must be a non-empty array of cookie objects");
        }
        for (let i = 0; i < cookiesVal.length; i++) {
          const item = cookiesVal[i];
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new CredentialPayloadError(`Cookie item at index ${i} must be an object`);
          }
          const cookie = this.normalizeAndValidateCookieItem(cleanPortal, item, defaultDomain, i);
          result.cookies.push(cookie);
        }
        const extraKeys = Object.keys(obj).filter((k) => k !== "cookies");
        if (extraKeys.length > 0) {
          throw new CredentialPayloadError(
            `Ambiguous credential payload: cannot mix 'cookies' with other top-level fields (${extraKeys.join(", ")})`
          );
        }
        return result;
      }

      // Case 4: Key-Value Cookie Dictionary -> { "li_at": "...", "JSESSIONID": "..." }
      const entries = Object.entries(obj);
      if (entries.length === 0) {
        throw new CredentialPayloadError("Cookie dictionary payload cannot be empty");
      }
      for (const [name, val] of entries) {
        const cleanName = name.trim();
        if (!cleanName || /[\x00-\x1F\x7F\s;,=]/.test(cleanName)) {
          throw new CredentialPayloadError(
            `Cookie dictionary key contains illegal control or delimiter characters: '${name}'`
          );
        }
        if (typeof val !== "string" || val.trim().length === 0) {
          throw new CredentialPayloadError(`Cookie value for '${name}' must be a non-empty string`);
        }
        const cleanVal = val.trim();
        if (/[\x00-\x1F\x7F\r\n]/.test(cleanVal)) {
          throw new CredentialPayloadError(
            `Cookie value for '${name}' contains illegal control or CR/LF characters`
          );
        }
        const cookie: ValidatedPlaywrightCookie = {
          name: cleanName,
          value: cleanVal,
          domain: defaultDomain,
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        };
        result.cookies.push(cookie);
      }
      return result;
    }

    // Case 5: Raw Cookie Header string -> "li_at=xxxx; JSESSIONID=yyyy"
    if (trimmed.includes("=")) {
      const pairs = trimmed.split(";").map((p) => p.trim()).filter(Boolean);
      if (pairs.length === 0) {
        throw new CredentialPayloadError("Raw cookie header string contains no valid key=value pairs");
      }
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx <= 0) {
          throw new CredentialPayloadError(`Malformed cookie pair '${pair}' in raw header string`);
        }
        const name = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (!name || !value) {
          throw new CredentialPayloadError(`Empty name or value in cookie pair '${pair}'`);
        }
        if (/[\x00-\x1F\x7F\s;,=]/.test(name)) {
          throw new CredentialPayloadError(
            `Cookie name '${name}' in raw header contains illegal control or delimiter characters`
          );
        }
        if (/[\x00-\x1F\x7F\r\n]/.test(value)) {
          throw new CredentialPayloadError(
            `Cookie value for '${name}' in raw header contains illegal control or CR/LF characters`
          );
        }
        result.cookies.push({
          name,
          value,
          domain: defaultDomain,
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        });
      }
      return result;
    }

    throw new CredentialPayloadError(
      "Unrecognized credential format. Must be a Cookie array, Cookie dictionary, Raw cookie header, or { headers } object."
    );
  }

  /**
   * Atomic Validation & Context Mutation:
   * Validates entire payload first before performing any browser mutations.
   * If validation fails, zero cookies and zero headers are injected.
   */
  public static async injectIntoBrowserContext(
    browserContext: BrowserContext,
    portal: string,
    secretPayload: string
  ): Promise<{ cookieCount: number; headerCount: number }> {
    if (!browserContext) {
      throw new Error("Cannot inject credentials: browserContext is undefined or null");
    }

    // 1. Complete validation pass (throws on any defect)
    const { cookies, headers } = this.parseAndValidate(portal, secretPayload);

    // 2. Perform Playwright BrowserContext mutations
    if (cookies.length > 0) {
      await browserContext.addCookies(cookies);
    }

    if (Object.keys(headers).length > 0) {
      await browserContext.setExtraHTTPHeaders(headers);
    }

    // Return non-secret telemetry count
    return {
      cookieCount: cookies.length,
      headerCount: Object.keys(headers).length,
    };
  }

  private static normalizeAndValidateCookieItem(
    portal: string,
    item: Record<string, unknown>,
    defaultDomain: string,
    index: number
  ): ValidatedPlaywrightCookie {
    const name = item.name;
    const value = item.value;

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new CredentialPayloadError(`Cookie at index ${index} must have a non-empty 'name' string`);
    }
    const cleanName = name.trim();
    if (/[\x00-\x1F\x7F\s;,=]/.test(cleanName)) {
      throw new CredentialPayloadError(
        `Cookie name at index ${index} contains illegal control or delimiter characters: '${cleanName}'`
      );
    }

    if (typeof value !== "string" || value.trim().length === 0) {
      throw new CredentialPayloadError(`Cookie at index ${index} must have a non-empty 'value' string`);
    }
    const cleanValue = value.trim();
    if (/[\x00-\x1F\x7F\r\n]/.test(cleanValue)) {
      throw new CredentialPayloadError(
        `Cookie value for '${cleanName}' at index ${index} contains illegal control or CR/LF characters`
      );
    }

    const domain = (typeof item.domain === "string" && item.domain.trim().length > 0)
      ? item.domain.trim()
      : defaultDomain;

    // Strict domain allowlist validation
    if (!this.isPermittedDomain(portal, domain)) {
      throw new CredentialDomainSecurityError(
        `Domain '${domain}' is not permitted for portal '${portal}'. Permitted domains: ${PORTAL_DOMAINS[portal]?.join(", ")}`
      );
    }

    const path = typeof item.path === "string" && item.path.trim().length > 0
      ? item.path.trim()
      : "/";

    if (!path.startsWith("/") || /[\x00-\x1F\x7F\r\n]/.test(path)) {
      throw new CredentialPayloadError(
        `Cookie path for '${cleanName}' at index ${index} must start with '/' and contain no control characters: '${path}'`
      );
    }

    const cookie: ValidatedPlaywrightCookie = {
      name: cleanName,
      value: cleanValue,
      domain,
      path,
      httpOnly: typeof item.httpOnly === "boolean" ? item.httpOnly : true,
      secure: typeof item.secure === "boolean" ? item.secure : true,
      sameSite: (item.sameSite === "Strict" || item.sameSite === "Lax" || item.sameSite === "None")
        ? item.sameSite
        : "Lax",
    };

    if (item.expires !== undefined && item.expires !== null) {
      if (typeof item.expires !== "number" || !Number.isFinite(item.expires) || item.expires < 0 || item.expires > 8640000000000) {
        throw new CredentialPayloadError(
          `Cookie 'expires' for '${cleanName}' at index ${index} must be a finite positive timestamp: ${item.expires}`
        );
      }
      cookie.expires = item.expires;
    }

    return cookie;
  }

  private static validateHeaderEntry(
    key: string,
    value: unknown,
    outHeaders: Record<string, string>
  ): void {
    const cleanKey = key.trim();
    if (!cleanKey) {
      throw new CredentialHeaderSecurityError("Header name cannot be empty");
    }

    if (/[\r\n\x00-\x1F\x7F]/.test(cleanKey)) {
      throw new CredentialHeaderSecurityError(
        `Header name contains illegal control or CR/LF characters: '${cleanKey}'`
      );
    }

    const lowerKey = cleanKey.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lowerKey)) {
      if (lowerKey === "cookie") {
        throw new CredentialHeaderSecurityError(
          "Header 'cookie' is strictly forbidden in extraHTTPHeaders. Cookies must enter through Playwright cookie injection."
        );
      }
      throw new CredentialHeaderSecurityError(
        `Header '${cleanKey}' is a forbidden browser/transport header and cannot be injected.`
      );
    }

    if (typeof value !== "string" || value.trim().length === 0) {
      throw new CredentialHeaderSecurityError(`Header value for '${cleanKey}' must be a non-empty string`);
    }

    const cleanValue = value.trim();
    if (/[\r\n\x00-\x1F\x7F]/.test(cleanValue)) {
      throw new CredentialHeaderSecurityError(
        `Header value for '${cleanKey}' contains illegal control or CR/LF characters`
      );
    }

    outHeaders[cleanKey] = cleanValue;
  }
}
