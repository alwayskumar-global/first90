import { z } from "zod";

/**
 * Response envelopes as observed on the hackathon environment. Only the
 * fields we depend on are declared; everything else is ignored. Entities are
 * kept as `unknown` here and validated one by one in the normalizer, so a
 * single malformed record never discards a whole result page.
 */

export const searchResponseSchema = z.object({
  results: z.array(z.unknown()),
});

export const tagsResponseSchema = z.object({
  results: z.object({ tags: z.array(z.unknown()) }),
});

export const insightsResponseSchema = z.object({
  results: z.object({ entities: z.array(z.unknown()) }),
});

export const rawTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().optional(),
});

export const rawSearchEntitySchema = z.object({
  entity_id: z.string().min(1),
  name: z.string().min(1),
  types: z.array(z.string()).optional(),
});

const rawLocationSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  geohash: z.string().optional(),
});

/** Insights entity: required spine only; optional fields are read defensively. */
export const rawPlaceEntitySchema = z.object({
  entity_id: z.string().min(1),
  name: z.string().min(1),
  location: rawLocationSchema,
  popularity: z.number().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.unknown()).optional(),
  query: z
    .object({
      affinity: z.number().optional(),
      distance: z.number().optional(),
      explainability: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export type RawPlaceEntity = z.infer<typeof rawPlaceEntitySchema>;
