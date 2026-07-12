import { z } from 'zod';
import { AppError } from '../errors.js';
import type { DiscoveredModel } from './types.js';

const modelObjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  owned_by: z.string().optional(),
  ownedBy: z.string().optional(),
  context_length: z.number().int().positive().optional(),
  contextLength: z.number().int().positive().optional()
}).passthrough();

const modelEntrySchema = z.union([z.string(), modelObjectSchema]);
const modelArraySchema = z.array(modelEntrySchema);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function discoveredModel(value: z.infer<typeof modelEntrySchema>): DiscoveredModel | undefined {
  if (typeof value === 'string') {
    const id = value.trim();
    return id ? { id } : undefined;
  }
  const id = (value.id ?? value.name ?? value.model ?? '').trim();
  if (!id) return undefined;
  const ownedBy = value.owned_by ?? value.ownedBy;
  const contextLength = value.context_length ?? value.contextLength;
  return {
    id,
    ...(value.name && value.name !== id ? { name: value.name } : {}),
    ...(ownedBy ? { ownedBy } : {}),
    ...(contextLength ? { contextLength } : {})
  };
}

export function parseModelResponse(payload: unknown, allowDirectArray: boolean): DiscoveredModel[] {
  let rawList: unknown;
  if (Array.isArray(payload)) {
    if (!allowDirectArray) {
      throw new AppError('provider_invalid_response', 502, 'A direct model array is accepted only for custom OpenAI-compatible providers.');
    }
    rawList = payload;
  } else {
    const root = record(payload);
    rawList = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : undefined;
  }
  const parsed = modelArraySchema.safeParse(rawList);
  if (!parsed.success) throw new AppError('provider_invalid_response', 502, 'The models endpoint returned an invalid schema.');
  const seen = new Set<string>();
  const output: DiscoveredModel[] = [];
  for (const entry of parsed.data) {
    const model = discoveredModel(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    output.push(model);
  }
  return output.slice(0, 1000);
}
