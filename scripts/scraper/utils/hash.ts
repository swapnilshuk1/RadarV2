import crypto from "crypto";

export function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function shortHash(input: string, len = 12): string {
  return sha1(input).slice(0, len);
}

export function jobHash(role: string, company: string): string {
  const clean = `${role.toLowerCase().trim()}|${company.toLowerCase().trim()}`;
  return "j-" + crypto.createHash("sha256").update(clean).digest("hex").slice(0, 12);
}

export function canonicalizeUrl(portal: string, rawUrl: string): string {
  try {
    const urlObj = new URL(rawUrl, "https://example.com");
    if (portal === "Indeed") {
      const jk = urlObj.searchParams.get("jk");
      if (jk) return `https://in.indeed.com/viewjob?jk=${jk}`;
    }
  } catch (e) {}
  
  // Default fallback for LinkedIn, Naukri, and generic portals
  return rawUrl.split("?")[0];
}

export function cardHashFor(portal: string, url: string): string {
  const canonical = canonicalizeUrl(portal, url);
  return shortHash(`${portal}::${canonical}`, 16);
}
