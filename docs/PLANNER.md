# Planner and agent workflow (Milestone 2)

Implements PROJECT_PLAN.md sections 4 and 7 (Milestone 2). Code lives in `src/lib/agent/`; Qloo access in `src/lib/qloo/`.

## Workflow

`buildPlan` runs five observable steps and returns a `PlanSession` plus a `StepTrace[]` (safe to show; no payloads, ids or keys).

| Step | What it does |
|---|---|
| `resolve_interests` | Each interest becomes a preference ("quiet mornings"), a built-in alias, an exact Qloo tag, or a named Qloo entity. Several equal matches -> `needsConfirmation`; no match -> noted, never guessed. |
| `discover_places` | One `/v2/insights` query per category (two at a time, paced): `filter.tags` = the category tag; `signal.interests.tags/entities` = the user's other picks; `feature.explainability=true` when an entity pick exists; radius always explicit; price ceiling sent only for categories that carry prices. |
| `apply_constraints` | Off-category noise filter, then hard limits (below). |
| `construct_plan` | Score, diversify, assign to the three stages. |
| `explain` | Deterministic text from the candidate's Qloo fields and the user's input. |

`revisePlan` applies one `Feedback` (`save`, `dismiss`, `replace` + optional reason) and returns the new session and a `PlanRevision`.

## Noise filter (`relevance.ts`)

Qloo category tags are broad (a discount store carried "Book store", a skating rink carried "Cafe"). Each result is checked against Qloo's own `primary_genre`: deny list first, then allow list, then (no primary genre) allowed genre tags, then the place's name (e.g. "... Cafe"). Places matched only by name or tag rank slightly lower. Dropped places carry a reason in tests; nothing is repaired or invented. Rules came from live Raleigh results and are covered by unit tests.

## Hard constraints (`constraints.ts`)

Applied before ranking and never relaxed silently:
- excluded (dismissed) entities
- radius, using the distance Qloo returns (a place with no distance cannot be verified, so it is excluded)
- price ceiling: a place over the ceiling is excluded; for categories Qloo prices reliably (cafés, Korean restaurants), a place with no price is excluded (the ceiling cannot be verified); **museums/cultural venues (CR-003) and bookstores (CR-004) with no price are kept and carry "Price not available — check current details."** No price filter is sent to Qloo for those two categories, because Qloo's filter would drop every unpriced place; a known price above the ceiling is still excluded locally.
- strict quiet (set by "too loud" feedback): excludes places Qloo tags `Loud` or with a lively ambience (`Lively`, `Social`, `High energy`, ...)

## Fit score (`scoring.ts`)

Our composite ranking aid. It is **not** a Qloo score or a probability and is never shown to users.

```
fit = 0.30 * affinity       Qloo query.affinity, min-max within the category pool; 0.5 if absent or flat
    + 0.08 * popularity     Qloo popularity (0-1); 0.5 if absent
    + 0.08 * rating         business_rating / 5 when 0 < r <= 5 (assumed 0-5 scale); else 0.5
    + w_prox(stage) * proximity   1 - distance/radius; w = 0.24 / 0.16 / 0.08 for week / month / months 2-3
    + 0.14 * atmosphere     quietScore (+1 quiet .. -1 lively) if the user prefers quiet (negated for lively)
    + 0.10 * morning        1 if Qloo lists a Morning / Early morning fit and the user prefers mornings
    + 0.08 * interestBoost  1 if the category matches a stated interest
    + 0.12 * stageFit       category-vs-stage table (cafes early, Korean mid, museums late)
    + 0.06 * directness     1 if Qloo's primary genre matches the category, 0.5 if matched by name/tags
    + adjustments           "not interested" category penalty (-0.15 each), indie-chain penalty (-0.15)
```

Atmosphere and morning signals are read only from Qloo's structured tags (`ambience`, `noise_level`, `time_of_day_fit`). The chain penalty applies only when an interest says "indie/independent/local"; it matches the place name and is never displayed as a claim. Ties break on Qloo entity ID ascending, so identical input and identical Qloo data give the identical plan (tested, including input-order independence).

## Assignment (`planner.ts`)

Stages are filled in order, 3 suggestions each, one per category within a stage where possible, no place twice. With fewer than nine eligible places, slots are spread (5 -> 2, 2, 1) so no stage is empty. If greedy fill leaves a stage holding a single category, a deterministic swap with another stage (best total fit, ties by id) restores a mix.

## Explanations (`explain.ts`)

Three honest bases, shown with every item (`PlanItem.basis`):
- `input_attribution`: Qloo returned per-pick contribution (entity picks only): "Your pick “X” contributed to how Qloo ranked it."
- `taste_signals`: Qloo ranked with tag picks but returns no attribution: "Qloo ranked it using your picks: ..." (no contribution claim).
- `category_and_distance`: no taste ranking returned.

Never a percentage or probability. Highlights are verbatim Qloo tags that back a stated preference. Every item carries "Check current hours, prices, and details before visiting." A link appears only if Qloo returned an http(s) website. An optional LLM wording adapter exists but is **off by default**; its output is rejected if it adds a number, percentage/probability language or a URL not in the facts.

## Revision (`revise.ts`)

Only the item the user acts on changes. Every other item keeps its content and position; saved items are never replaced by the engine.

| Reason | Constraint | Replacement |
|---|---|---|
| `too_expensive` | price ceiling = item price - 1 (if Qloo has the item's price) | same category if one still qualifies, under the new ceiling |
| `too_far` | radius halved (min 2 km) | same category within the new radius |
| `too_loud` | strict quiet on | same category, no loud/lively tags; says when quiet is unverified |
| `not_interested` | entity excluded + category penalty | any category (penalized one is less likely) |
| none | entity excluded | best eligible alternate |

If Qloo has no price for the item, the reason cannot be honored: the item is removed and a `limitation` says so. If nothing qualifies, `noMatch` carries a message and a concrete way to broaden the limit; the tightened limit stays. Other items that now break a tightened limit are listed in `PlanSession.outOfLimitItemIds` (left in place, to be shown as outside the limit). Qloo is re-queried only if the cached pool has no alternate under a new price ceiling.

## Why this is an agent, not a single call

A bounded tool-use loop: resolve (tags/search) -> query (insights, per category, with the user's picks as signals) -> filter and constrain -> construct -> explain -> revise from feedback by recomputing from validated candidates, or re-querying Qloo with a tighter server-side filter when the cached pool is insufficient. Every step is recorded in a trace; every place card is built from typed tool results, never from generated text.
