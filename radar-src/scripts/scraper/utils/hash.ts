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

export function cardHashFor(portal: string, url: string): string {
  return shortHash(`${portal}::${url.split("?")[0]}`, 16);
}
