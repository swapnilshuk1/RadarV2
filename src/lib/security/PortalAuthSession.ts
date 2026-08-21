import type { BrowserContext } from "playwright";
import type { CredentialStatus } from "../../domain/entities";
import type { AuthContext } from "./auth";
import {
  CredentialBroker,
  CredentialNotFoundError,
  type CredentialLease,
} from "./CredentialBroker";
import { PlaywrightCredentialInjector } from "./PlaywrightCredentialInjector";

/**
 * Narrow runtime authentication session handle attached to scraper contexts.
 *
 * Hard Invariant:
 * Holds ZERO secret payload material. Allows portal runners to report verified
 * authentication health or invalidation back to CredentialBroker without exposing
 * credentials to general scraper state, logging, or telemetry.
 */
export interface PortalAuthSession {
  readonly credentialId: string;
  readonly tenantId: string;
  readonly source: string;
  readonly version: number;

  /**
   * Reports session health status back to CredentialBroker.
   * Scraper errors (DOM timeouts, selector failures) MUST NOT invoke this.
   */
  reportHealth(status: CredentialStatus, reason?: string): Promise<void>;

  /**
   * Disposes the session handle, preventing subsequent health mutations.
   */
  dispose(): void;
}

/**
 * Establishes an authenticated scraper session via JIT leasing and browser injection.
 *
 * Memory & Lifetime Invariant:
 * The broker lease is not retained after injection. The secret-bearing lease object
 * is removed from application ownership immediately after the injection attempt.
 * RADAR does not claim cryptographic memory zeroization of JavaScript runtime strings.
 *
 * Error & Fallback Contract:
 * - CredentialNotFoundError: Returns null, allowing the scraper to proceed with anonymous
 *   public scraping if supported by the portal.
 * - CredentialAuthorizationError / CredentialLifecycleError / CredentialExpiredError / unexpected:
 *   Rethrown immediately (fail-closed). Authorization or lifecycle failures MUST NOT
 *   silently decay into unauthenticated anonymous scraping.
 */
export async function establishPortalAuthSession(
  broker: CredentialBroker,
  auth: AuthContext,
  portal: string,
  browserContext: BrowserContext
): Promise<PortalAuthSession | null> {
  const cleanPortal = portal.toLowerCase().trim();

  // 1. Lease credential JIT
  let lease: CredentialLease | null = null;
  try {
    lease = await broker.leaseCredential(auth, cleanPortal);
  } catch (err: any) {
    if (err instanceof CredentialNotFoundError) {
      // Credential is not configured for this portal in this tenant -> allow anonymous scraping fallback
      return null;
    }
    // Hard Invariant: Authorization, lifecycle, expiration, and broker errors MUST NOT silently fall back to anonymous scraping!
    throw err;
  }

  if (!lease) {
    return null;
  }

  // 2. Inject into Playwright BrowserContext with full domain & header validation
  try {
    await PlaywrightCredentialInjector.injectIntoBrowserContext(
      browserContext,
      cleanPortal,
      lease.secretPayload
    );
  } finally {
    // 3. Hard Invariant: Relinquish application ownership of the secret payload immediately
    try {
      delete (lease as any).secretPayload;
    } catch {}
  }

  // 4. Return narrow PortalAuthSession containing ONLY metadata and health callback
  const credentialId = lease.credentialId;
  const tenantId = lease.tenantId;
  const source = lease.source;
  const version = lease.version;
  let isDisposed = false;

  return {
    credentialId,
    tenantId,
    source,
    version,
    async reportHealth(status: CredentialStatus, reason?: string): Promise<void> {
      if (isDisposed) return;
      await broker.reportCredentialHealth(auth, credentialId, status, reason);
    },
    dispose(): void {
      isDisposed = true;
    },
  };
}
