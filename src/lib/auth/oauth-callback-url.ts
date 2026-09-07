export function isLocalOAuthHost(host: string): boolean {
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function shouldUseSecureOAuthCookie(host: string): boolean {
  return !isLocalOAuthHost(host);
}

export function resolveGoogleCallbackUrl(host: string, configuredRedirectUri: string | undefined): string {
  if (isLocalOAuthHost(host)) return `http://${host}/api/auth/callback`;
  if (!configuredRedirectUri) throw new Error("[Auth] GOOGLE_REDIRECT_URI is required for non-local OAuth callbacks.");
  let parsed: URL;
  try { parsed = new URL(configuredRedirectUri); } catch { throw new Error("[Auth] GOOGLE_REDIRECT_URI must be a valid HTTPS URL."); }
  if (parsed.protocol !== "https:") throw new Error("[Auth] GOOGLE_REDIRECT_URI must use HTTPS outside localhost.");
  return parsed.toString();
}
