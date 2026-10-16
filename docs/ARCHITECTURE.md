# Architecture (Milestones 1–2)

```
src/
  domain/
    demo.ts            locked demo area, 4 categories + Qloo tag ids, interest aliases
    types.ts           TasteInput, ResolvedInterest, PlaceCandidate, Evidence; Plan/PlanItem/Feedback/PlanRevision (declared for M2)
  lib/
    config.ts          server-only env reading (lazy, never logs values)
    qloo/
      client.ts        auth header, timeout, bounded retry, error mapping
      errors.ts        QlooError kinds (auth, rate_limit, timeout, ...)
      validate.ts      rejects params Qloo would silently ignore; requires radius with location
      schemas.ts       zod envelopes for /search, /v2/tags, /v2/insights
      resolveInterests.ts   text -> tag candidates: resolved | ambiguous | unmatched
      discoverPlaces.ts     category + area (+ signals/constraints) -> PlaceCandidate[]
      normalizePlace.ts     raw record -> PlaceCandidate, or null if malformed
    agent/
      preferences.ts   "quiet mornings" -> atmosphere/routine preference (not a Qloo signal)
      relevance.ts     off-category noise filter (primary_genre allow/deny lists)
      constraints.ts   hard limits: exclusions, radius, price ceiling, strict quiet; out-of-limit flags
      atmosphere.ts    quiet / lively / morning signals read from Qloo tags
      scoring.ts       documented fit score + stable tie-break (see PLANNER.md)
      planner.ts       diversity and three-stage assignment
      explain.ts       grounded explanations; optional, validated LLM wording hook (off by default)
      revise.ts        save / dismiss / replace + reason -> constraint, one-item revision
      pipeline.ts      resolution summary, per-category Qloo queries, eligibility
      workflow.ts      buildPlan / revisePlan with step traces
      rubric.ts        handwritten acceptance rubric (grounding, diversity, constraints)
      scenarios.ts     the live demo scenarios used for verification
      trace.ts         observable StepTrace recorder
  domain/schemas.ts    zod request schemas for the plan API
  lib/qloo/cache.ts    in-memory TTL cache (private, bounded, never written to disk)
  server/              product API handlers (planApi), error mapping, per-visitor rate limiter, runtime wiring
  app/api/plan         POST build (NDJSON step stream) / revise; app/api/interests POST resolve one interest
  lib/flow/            client state (reducer + localStorage), TasteInput builder, labels, API client
  screens/             Welcome, Location, Interests, Preferences, Building, Plan, PlaceDetail, ReplaceDialog
  components/          Icon (Lucide), Button, Badge, Chip, StageNav, StateBanner
  styles/              design tokens and component CSS from the supplied design system
  app/api/diagnostics/qloo/route.ts   dev-only live check
  app/api/diagnostics/plan/route.ts   dev-only plan engine (build / revise / scenarios)
```

## Rules the code enforces

- **Server only.** `config.ts` and the Qloo modules import `server-only`; the key is sent in the `X-Api-Key`
  header, never in a URL, log or error message.
- **Validate before sending.** Qloo ignores unsupported parameters silently, so `validate.ts` allow-lists
  place parameters and requires an explicit radius (omitting it returns zero results).
- **Failure modes.** 401/403 -> `auth`; 429 -> `rate_limit` (never retried; `Retry-After` surfaced);
  timeouts, network errors and 5xx retry up to `maxRetries` (default 2) with backoff; malformed 200s ->
  `invalid_response`.
- **No invented facts.** `normalizePlace` copies a field only when Qloo returned it in the expected type.
  Malformed records are dropped and counted, not repaired. URLs must be http(s).
- **Affinity is a ranking signal.** `Evidence.affinity` is stored as returned; do not present it as a
  probability. `Evidence.explainability` is per-input attribution (which signal entities contributed), not
  reasons.
- **Interest resolution is conservative.** Only exact (normalized) tag-name matches count; near-misses
  become `unmatched`. Several exact place-scoped tags become `ambiguous` so the UI can ask.

## Observed Qloo behavior (hackathon environment, Milestone 0)

- `filter.location` + `filter.location.radius` (meters) works; omitting radius returned 0 results.
- `filter.price_level.max` and `filter.exclude.entities` are honored.
- `feature.explainability=true` works for places with entity signals.
- Tag-filtered results can contain off-category places; the M2 planner must post-filter on returned tags.
- Museums return no price level, and most bookstores none; price limits cannot be checked for them (CR-003, CR-004): kept and flagged.
- Climbing venues were not found in Raleigh (dropped from the demo).

- Tag signals return `query.affinity` but no explainability; entity signals return both.
- Category tags are noisy; `primary_genre`, ambience, noise-level and time-of-day tags are reliable enough to filter and explain.
- A burst of ~25 requests in a few seconds triggered a 429 on the event key; the diagnostic client paces requests (400 ms) and the workflow keeps at most two in flight.

## Not yet built (later milestones)

UI from Kumar's designs (M3); production API routes, usage throttling, signed sessions, deployment (M4).
