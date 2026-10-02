import { z } from "zod";
import canonical from "../../data/ontology/executive_ontology.json";

const id = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v), "Reserved identity");
export const intelligenceNodeSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    kind: z.enum(["domain", "discipline", "capability"]),
    parentId: id.nullable(),
    aliases: z.array(z.string().trim().min(2).max(160)).max(80),
    description: z.string().trim().max(1000).default(""),
    classification: z.enum(["CORE", "ADJACENT", "CONTEXT"]).default("CORE"),
    retired: z.boolean().default(false),
  })
  .strict();
export const intelligenceTaxonomySchema = z
  .object({
    version: z.literal("intelligence-taxonomy/v1"),
    nodes: z.array(intelligenceNodeSchema).min(1).max(500),
  })
  .strict();
export type IntelligenceTaxonomy = z.infer<typeof intelligenceTaxonomySchema>;
export type IntelligenceNode = z.infer<typeof intelligenceNodeSchema>;
export const baselineIntelligenceTaxonomy: IntelligenceTaxonomy = {
  version: "intelligence-taxonomy/v1",
  nodes: canonical.domains.flatMap((d) => [
    {
      id: d.id,
      name: d.name,
      kind: "domain" as const,
      parentId: null,
      aliases: [],
      description: "",
      classification: "CORE" as const,
      retired: false,
    },
    ...d.disciplines.flatMap((s) => [
      {
        id: s.id,
        name: s.name,
        kind: "discipline" as const,
        parentId: d.id,
        aliases: [],
        description: "",
        classification: "CORE" as const,
        retired: false,
      },
      ...s.capabilities.map((c) => ({
        id: c.id,
        name: c.name,
        kind: "capability" as const,
        parentId: s.id,
        aliases: c.keywords,
        description: "",
        classification: "CORE" as const,
        retired: false,
      })),
    ]),
  ]),
};
const normalized = (v: string) =>
  v
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const baselineOwners = new Map<string, Set<string>>();
for (const node of baselineIntelligenceTaxonomy.nodes)
  for (const alias of [node.name, ...node.aliases]) {
    const key = normalized(alias);
    const owners = baselineOwners.get(key) ?? new Set<string>();
    owners.add(node.id);
    baselineOwners.set(key, owners);
  }
export function validateIntelligenceTaxonomy(value: unknown): IntelligenceTaxonomy {
  const taxonomy = intelligenceTaxonomySchema.parse(value),
    nodes = new Map<string, IntelligenceNode>(),
    aliases = new Map<string, string>();
  for (const node of taxonomy.nodes) {
    if (nodes.has(node.id)) throw new Error("INTELLIGENCE_DUPLICATE_ID");
    nodes.set(node.id, node);
  }
  for (const node of taxonomy.nodes) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (
      node.kind === "domain"
        ? node.parentId !== null
        : !parent || parent.kind !== (node.kind === "discipline" ? "domain" : "discipline")
    )
      throw new Error("INTELLIGENCE_INVALID_PARENT");
    if (!node.retired && parent?.retired) throw new Error("INTELLIGENCE_RETIRED_PARENT");
    if (node.retired) continue;
    for (const alias of [node.name, ...node.aliases]) {
      const key = normalized(alias);
      if (!key) throw new Error("INTELLIGENCE_INVALID_ALIAS");
      const owner = aliases.get(key);
      if (
        owner &&
        owner !== node.id &&
        !(baselineOwners.get(key)?.has(owner) && baselineOwners.get(key)?.has(node.id))
      )
        throw new Error(`INTELLIGENCE_DUPLICATE_ALIAS:${alias}`);
      aliases.set(key, node.id);
    }
  }
  if (!taxonomy.nodes.some((n) => !n.retired && n.kind === "capability"))
    throw new Error("INTELLIGENCE_ACTIVE_CAPABILITY_REQUIRED");
  return taxonomy;
}
export function intelligenceReference(taxonomy: IntelligenceTaxonomy) {
  return validateIntelligenceTaxonomy(taxonomy)
    .nodes.filter((n) => !n.retired)
    .map(({ description: _description, retired: _retired, ...node }) => node);
}
export function matchIntelligence(taxonomy: IntelligenceTaxonomy, text: string) {
  const content = ` ${normalized(text)} `;
  return intelligenceReference(taxonomy).filter((n) =>
    [n.name, ...n.aliases].some((a) => content.includes(` ${normalized(a)} `)),
  );
}
/** Intent stays explicit; ontology terms supply alternative phrasing, never a veto. */
export function expandIntelligenceFunctions(taxonomy: IntelligenceTaxonomy, functions: string[]) {
  return [
    ...new Set(
      functions.flatMap((f) => {
        const node = taxonomy.nodes.find(
          (n) =>
            !n.retired &&
            (n.id === f || [n.name, ...n.aliases].some((a) => normalized(a) === normalized(f))),
        );
        return node ? [f, node.name, ...node.aliases.slice(0, 4)] : [f];
      }),
    ),
  ];
}
