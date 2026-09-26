import crypto from "crypto";

function oauthStateSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be configured with at least 32 characters before OAuth can start.");
  }
  return secret;
}

export interface OAuthStatePayload {
  state: string;
  verifier: string;
  ts: number;
}

export function createSignedOAuthState(rawState: string, verifier: string): string {
  const payload: OAuthStatePayload = {
    state: rawState,
    verifier,
    ts: Date.now()
  };
  const json = JSON.stringify(payload);
  const base64 = Buffer.from(json).toString("base64url");
  const hmac = crypto.createHmac("sha256", oauthStateSecret()).update(base64).digest("base64url");
  return `${base64}.${hmac}`;
}

export function verifySignedOAuthState(signedState: string | null): OAuthStatePayload | null {
  if (!signedState) return null;
  try {
    const parts = signedState.split(".");
    if (parts.length !== 2) return null;

    const [base64, sig] = parts;
    const expectedHmac = crypto.createHmac("sha256", oauthStateSecret()).update(base64).digest("base64url");

    if (sig.length !== expectedHmac.length) return null;

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedHmac);

    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const json = Buffer.from(base64, "base64url").toString("utf-8");
    const payload: OAuthStatePayload = JSON.parse(json);

    // Max 15 minutes state validity
    if (Date.now() - payload.ts > 15 * 60 * 1000) {
      return null;
    }

    return payload;
  } catch (err) {
    return null;
  }
}
