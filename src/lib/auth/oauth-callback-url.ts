export function resolveGoogleCallbackUrl(host: string, configuredRedirectUri: string | undefined): string {
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (local) return `http://${host}/api/auth/callback`;
  if (!configuredRedirectUri) throw new Error("[Auth] GOOGLE_REDIRECT_URI is required for non-local OAuth callbacks.");
  let parsed: URL;
  try { parsed = new URL(configuredRedirectUri); } catch { throw new Error("[Auth] GOOGLE_REDIRECT_URI must be a valid HTTPS URL."); }
  if (parsed.protocol !== "https:") throw new Error("[Auth] GOOGLE_REDIRECT_URI must use HTTPS outside localhost.");
  return parsed.toString();
}
