/** Source identity is a closed application-owned catalog, not generated prose. */
export function bindMemoReferences(
  schema: Record<string, unknown>,
  catalog: { claimIds: string[]; requirementIds: string[]; resolutionFields: string[] },
): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, walk(item)]),
    );
    const properties = result.properties as Record<string, any> | undefined;
    if (properties) {
      for (const key of [
        "evidenceRefs",
        "claimIds",
        "requirementIds",
        "resolutionFields",
      ] as const) {
        const ids = key === "evidenceRefs" ? catalog.claimIds : catalog[key];
        if (properties[key] && ids.length)
          properties[key] = { ...properties[key], items: { ...properties[key].items, enum: ids } };
      }
    }
    return result;
  };
  return walk(schema) as Record<string, unknown>;
}
