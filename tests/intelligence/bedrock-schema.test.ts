import { describe, expect, it } from 'vitest';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { researchSchema } from '../../src/dossier/contracts';
import { modelSchema } from '../../src/dossier/model-schema';

describe('Bedrock Research schema projection', () => {
  it('preserves structural Research constraints in the supported JSON Schema subset', () => {
    const schema: any = bedrockJsonSchema(researchSchema);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(schema.required).toEqual(expect.arrayContaining(['claims', 'resolutions', 'evaluation', 'narrativePlan']));
    expect(schema.properties.resolutions).toMatchObject({ type: 'array', minItems: 1 });
    const resolution = schema.properties.resolutions.items;
    expect(resolution.required).toContain('methods');
    expect(resolution.required).not.toContain('question');
    expect(resolution.properties.methods).toMatchObject({ type: 'array', minItems: 1 });
    expect(resolution.properties.methods.items.enum).toContain('ask');
    expect(schema.properties.evaluation.properties.requirements).toMatchObject({ type: 'array', minItems: 1 });
    expect(modelSchema(researchSchema).type).toBe('OBJECT');
  });
});
