import { z } from 'zod';

/** Project the same runtime contract into the provider's structured-output subset.
 * Zod remains authoritative for semantic refinements and min/max validation. */
export function modelSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return modelSchema(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { ...modelSchema(schema.unwrap()), nullable: true };
  if (schema instanceof z.ZodString) return { type: 'STRING' };
  if (schema instanceof z.ZodNumber) return { type: 'NUMBER' };
  if (schema instanceof z.ZodBoolean) return { type: 'BOOLEAN' };
  if (schema instanceof z.ZodEnum) return { type: 'STRING', enum: schema.options };
  if (schema instanceof z.ZodArray) return { type: 'ARRAY', items: modelSchema(schema.element) };
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map(modelSchema) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return { type: 'OBJECT', properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, modelSchema(value)])), required: Object.keys(shape).filter(key => !shape[key].isOptional()), propertyOrdering: Object.keys(shape) };
  }
  throw new Error('Unsupported dossier output schema');
}
