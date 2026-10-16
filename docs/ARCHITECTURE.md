# Architecture (Milestone 1)

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
  app/api/diagnostics/qloo/route.ts   dev-only live check
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
- Museums return no price level; price limits cannot be checked for them.
- Climbing venues were not found in Raleigh (dropped from the demo).

## Not yet built (later milestones)

Planner, explanations, revision loop (M2); UI from Kumar's designs (M3); hardening, rate limiting,
deployment (M4).
