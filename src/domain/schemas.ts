import { z } from "zod";
import { CUISINE_TAG_PATTERN } from "./cuisine";
import { CATEGORY_KEYS, DEMO_BOUNDS, NEIGHBORHOOD_KEYS } from "./demo";
import { FEEDBACK_REASONS, STAGE_KEYS } from "./types";
import type { Feedback, PlanSession, TasteInput } from "./types";

/**
 * Request validation for the plan API. A session round-trips through the
 * browser (the app has no database), so the server re-validates its shape on
 * every request. This guards shape and ranges, not authenticity: a session is
 * the user's own state, and every item in it came from this server earlier.
 */
const categoryKey = z.enum(CATEGORY_KEYS);
const stageKey = z.enum(STAGE_KEYS as [string, ...string[]]);
const reason = z.enum(FEEDBACK_REASONS as [string, ...string[]]);

/** A place chosen from geocoder search. Bounds and label are re-validated here; the label ends up in plan text. */
export const customAreaSchema = z.object({
  lat: z.number().min(DEMO_BOUNDS.minLat).max(DEMO_BOUNDS.maxLat),
  lon: z.number().min(DEMO_BOUNDS.minLon).max(DEMO_BOUNDS.maxLon),
  label: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[^\u0000-\u001f\u007f<>]+$/),
});

export const tasteInputSchema = z.object({
  interests: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
  confirmations: z.record(z.string(), z.string().max(200)).optional(),
  areaKey: z.string().max(40),
  neighborhoodKey: z.enum(NEIGHBORHOOD_KEYS as [string, ...string[]]).optional(),
  customArea: customAreaSchema.optional(),
  cuisineTagId: z.string().regex(CUISINE_TAG_PATTERN).optional(),
  radiusMeters: z.number().min(1_000).max(50_000),
  categories: z.array(categoryKey).min(1).max(4),
  maxPriceLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  atmosphere: z.enum(["quiet", "lively", "no_preference"]),
  preferMornings: z.boolean(),
  strictQuiet: z.boolean().optional(),
})
  .refine((input) => !(input.customArea && input.neighborhoodKey), { message: "Choose a neighborhood or a searched place, not both.", path: ["customArea"] }) satisfies z.ZodType<TasteInput>;

export const feedbackSchema = z.object({
  itemId: z.string().max(100),
  action: z.enum(["save", "dismiss", "replace"]),
  reason: reason.optional(),
}) as unknown as z.ZodType<Feedback>;

const interestMatch = z.object({
  kind: z.enum(["entity", "tag"]),
  id: z.string().max(200),
  name: z.string().max(200),
  type: z.string().max(200).optional(),
  source: z.enum(["curated", "qloo"]),
});

const resolvedInterest = z.union([
  z.object({ status: z.literal("resolved"), input: z.string(), match: interestMatch }),
  z.object({
    status: z.literal("preference"),
    input: z.string(),
    preference: z.object({ atmosphere: z.enum(["quiet", "lively"]).optional(), morning: z.boolean().optional() }),
  }),
  z.object({ status: z.literal("ambiguous"), input: z.string(), matches: z.array(interestMatch) }),
  z.object({ status: z.literal("unmatched"), input: z.string() }),
]);

const evidence = z.object({
  signalEntityIds: z.array(z.string()),
  signalTagIds: z.array(z.string()),
  filterTagIds: z.array(z.string()),
  affinity: z.number().optional(),
  distanceMeters: z.number().optional(),
  explainability: z.array(z.object({ entityId: z.string(), score: z.number() })).optional(),
  tagNames: z.array(z.string()),
});

const placeCandidate = z.object({
  qlooEntityId: z.string().min(1),
  name: z.string().min(1),
  category: categoryKey,
  location: z.object({ lat: z.number(), lon: z.number(), geohash: z.string().optional() }),
  address: z.string().optional(),
  neighborhood: z.string().optional(),
  description: z.string().optional(),
  ambienceDescription: z.string().optional(),
  priceLevel: z.number().optional(),
  businessRating: z.number().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  primaryGenre: z.string().optional(),
  genreTags: z.array(z.string()),
  atmosphere: z.object({
    ambience: z.array(z.string()),
    noiseLevel: z.string().optional(),
    timeOfDay: z.array(z.string()),
    visitIntent: z.array(z.string()),
  }),
  hasHoursData: z.boolean(),
  popularity: z.number().optional(),
  evidence,
});

const planItem = z.object({
  id: z.string(),
  stage: stageKey,
  qlooEntityId: z.string(),
  category: categoryKey,
  routine: z.string(),
  why: z.string(),
  basis: z.enum(["input_attribution", "taste_signals", "category_and_distance"]),
  highlights: z.array(z.string()),
  notices: z.array(z.string()),
  externalUrl: z.string().optional(),
  status: z.enum(["suggested", "saved"]),
});

const appliedConstraint = z.object({
  kind: z.enum(["max_price", "radius", "strict_quiet", "exclude_entity", "category_penalty"]),
  label: z.string(),
  reason: z.string(),
  sourceItemId: z.string().optional(),
  category: categoryKey.optional(),
});

export const planSessionSchema = z.object({
  signature: z.string().max(100).optional(),
  plan: z.object({
    input: tasteInputSchema,
    queryRadiusMeters: z.number(),
    queryMaxPriceLevel: z.number().optional(),
    stages: z.object({ first_week: z.array(planItem), first_month: z.array(planItem), months_2_3: z.array(planItem) }),
    dismissedEntityIds: z.array(z.string()),
    constraints: z.array(appliedConstraint),
  }),
  candidates: z.record(z.string(), placeCandidate),
  interests: z.array(resolvedInterest),
  signals: z.array(z.object({ id: z.string(), kind: z.enum(["entity", "tag"]), label: z.string() })),
  outOfLimitItemIds: z.array(z.string()),
  coverage: z
    .array(z.object({ category: categoryKey, loaded: z.boolean(), eligible: z.number(), inPlan: z.number() }))
    .optional(),
  needsConfirmation: z.array(z.object({ input: z.string(), matches: z.array(interestMatch) })),
  notes: z.array(z.string()),
}) as unknown as z.ZodType<PlanSession>;
