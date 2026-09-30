/** Deterministic résumé copy assembled only from uploaded candidate evidence. */
import { extractFigures } from "./approval";
import type { CandidateClaim, ResumeBullet } from "./types";

export type SourceTextByDocument = ReadonlyMap<string, string>;

const SOURCE_NOISE = /^%PDF|^[A-Z]{6}\+|^\/?(?:Type|Font|Encoding)\b/i;
const clean = (text: string) =>
  text
    .replace(/^\s*(?:[•·▪◼■]|[-–—]|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

const textKey = (text: string) =>
  clean(text).toLowerCase().replace(/[^a-z0-9%$₹]+/g, " ").trim();

const sourceBlocks = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-•▪]|\d+[.)])\s+/.test(line))
    .map(clean)
    .filter((line) => line.length > 0);

export function sourceBlockForClaim(
  claim: CandidateClaim,
  sourceTextByDocument?: SourceTextByDocument,
): string | null {
  if (!claim.sourceDocumentId || !sourceTextByDocument) return null;
  const raw = sourceTextByDocument.get(claim.sourceDocumentId);
  if (!raw) return null;
  const needles = [claim.statement, claim.sourceLocator ?? ""]
    .map(textKey)
    .filter((key) => key.length >= 12);
  if (needles.length === 0) return null;
  const candidates = sourceBlocks(raw).filter((block) => {
    const key = textKey(block);
    return needles.some((needle) => key.includes(needle));
  });
  return candidates.sort((a, b) => a.length - b.length)[0] ?? null;
}

const figuresPreserved = (shortText: string, candidate: string) => {
  const available = new Set(extractFigures(candidate));
  return extractFigures(shortText).every((figure) => available.has(figure));
};

/** Prefer fuller verbatim source wording only when it preserves every extracted figure. */
export function richestClaimText(
  claim: CandidateClaim,
  sourceTextByDocument?: SourceTextByDocument,
): string {
  const statement = clean(claim.statement);
  const sourceBlock = sourceBlockForClaim(claim, sourceTextByDocument);
  if (
    sourceBlock &&
    sourceBlock.length <= 1200 &&
    !SOURCE_NOISE.test(sourceBlock) &&
    figuresPreserved(statement, sourceBlock)
  ) {
    return sourceBlock;
  }
  const source = clean(claim.sourceLocator ?? "");
  return source.length > statement.length &&
    source.length <= 1200 &&
    !SOURCE_NOISE.test(source) &&
    figuresPreserved(statement, source)
    ? source
    : statement;
}

/** A short noun phrase with no leading action word, e.g. "13 APAC markets". */
const looksFragment = (text: string) =>
  text.split(/\s+/).length < 8 && !/[.!?]$/.test(text) && !/^[A-Z][a-z]/.test(text);

const sentence = (text: string) => (/[,;:.!?]$/.test(text) ? text : text + ".");

/** Companions must be licensed by the caller as the same semantic and employment bundle. */
export function evidenceBlock(
  anchor: CandidateClaim,
  companions: readonly CandidateClaim[] = [],
  sourceTextByDocument?: SourceTextByDocument,
): { bullet: ResumeBullet; usedClaimIds: string[] } {
  const key = (text: string) => textKey(text);
  const kept: string[] = [];
  for (const text of [anchor, ...companions].map((claim) =>
    richestClaimText(claim, sourceTextByDocument),
  )) {
    if (!text) continue;
    if (kept.some((existing) => key(existing).includes(key(text)))) continue;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (key(text).includes(key(kept[i]!))) kept.splice(i, 1);
    }
    kept.push(text);
  }

  let text = "";
  for (const part of kept) {
    const fragment = looksFragment(part);
    text = !text
      ? part
      : fragment
        ? text.replace(/[.;,]$/, "") + " — " + part
        : sentence(text) + " " + part;
  }
  text = text ? sentence(text) : "";

  return {
    bullet: { claimId: anchor.id, text, edited: false, provenance: anchor.provenance },
    usedClaimIds: [anchor.id, ...companions.map((claim) => claim.id)],
  };
}

export function deterministicExecutiveSummary(
  headline: string,
  impact: readonly ResumeBullet[],
  capabilities: readonly string[],
): string {
  const scope = capabilities.slice(0, 4).join(", ");
  const record = impact.slice(0, 2).map((item) => sentence(item.text)).join(" ");
  return [
    headline ? "Executive leader whose experience spans " + headline.toLowerCase() + "." : "",
    scope ? "Core strengths include " + scope + "." : "",
    record ? "Selected career evidence: " + record : "",
  ].filter(Boolean).join(" ");
}

const spanKey = (
  claim: CandidateClaim,
  sourceTextByDocument?: SourceTextByDocument,
) => {
  const sourceBlock = sourceBlockForClaim(claim, sourceTextByDocument);
  return sourceBlock ? textKey(sourceBlock) : textKey(claim.sourceLocator ?? "");
};
const isFragment = (claim: CandidateClaim) => looksFragment(clean(claim.statement));

/**
 * Rebuild role bullets as source-CV blocks instead of atomic fragments.
 * Exact source spans always collapse. Fragment adjacency is allowed only when
 * the caller confirms the two claims belong to the same semantic bundle.
 */
export function composeRoleBullets(
  ordered: readonly CandidateClaim[],
  limit = 6,
  canJoinAdjacent: (anchor: CandidateClaim, candidate: CandidateClaim) => boolean = () => false,
  sourceTextByDocument?: SourceTextByDocument,
): { bullets: ResumeBullet[]; usedClaimIds: string[] } {
  const groups: { anchor: CandidateClaim; companions: CandidateClaim[] }[] = [];
  const bySpan = new Map<string, (typeof groups)[number]>();

  for (const claim of ordered) {
    const key = spanKey(claim, sourceTextByDocument);
    const same = key.length > 40 ? bySpan.get(key) : undefined;
    const neighbour = !same && isFragment(claim)
      ? [...groups].reverse().find((group) =>
          group.anchor.sourceDocumentId === claim.sourceDocumentId &&
          group.anchor.employer === claim.employer &&
          Math.abs((group.anchor.sourceOrdinal ?? -99) - (claim.sourceOrdinal ?? 99)) <= 2 &&
          canJoinAdjacent(group.anchor, claim))
      : undefined;
    const target = same ?? neighbour;
    if (target) {
      target.companions.push(claim);
      continue;
    }
    const group = { anchor: claim, companions: [] as CandidateClaim[] };
    groups.push(group);
    if (key.length > 40) bySpan.set(key, group);
  }

  const blocks = groups
    .slice(0, limit)
    .map((group) => evidenceBlock(group.anchor, group.companions, sourceTextByDocument));
  return {
    bullets: blocks.map((block) => block.bullet),
    usedClaimIds: blocks.flatMap((block) => block.usedClaimIds),
  };
}
