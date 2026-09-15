import { z } from 'zod';

/** Bedrock Converse supports a Draft 2020-12 subset; Zod remains authoritative. */
export function bedrockJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodOptional) return bedrockJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { anyOf: [bedrockJsonSchema(schema.unwrap()), { type: 'null' }] };
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodArray) {
    const minLength = schema._def.minLength?.value;
    return { type: 'array', items: bedrockJsonSchema(schema.element), ...((minLength ?? 0) >= 1 ? { minItems: 1 } : {}) };
  }
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map(bedrockJsonSchema) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, bedrockJsonSchema(value)])),
      required: Object.keys(shape).filter(key => !shape[key].isOptional()),
      additionalProperties: false,
    };
  }
  throw new Error('Unsupported Bedrock structured-output schema');
}
