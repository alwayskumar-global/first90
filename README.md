# First 90 Days

**Build a life in a new city, one fitting routine at a time.**

First 90 Days turns a newcomer's few stated interests ("indie bookstores, Korean food, coffee shops, quiet mornings") into a
staged, revisable plan of real local places for their **First Week**, **First Month** and **Months 2–3**. Every place is a real
record returned by the [Qloo](https://docs.qloo.com) API, every sentence explaining a suggestion is built from fields Qloo
returned, and the user can save, replace or reject any suggestion and watch the plan change.

Built for the **Qloo Agentic Hackathon**. Demo city: **Raleigh, NC**. Live demo: <https://first90-three.vercel.app>.

## The problem

People who relocate get generic "best of" lists. Those lists don't help them rebuild familiar routines: a morning coffee place that
suits them, a bookshop to browse, somewhere to eat that feels like home, a cultural outing for a free afternoon. First 90 Days starts
from what the person already likes and paces suggestions across their first three months, as *ideas to try*, never as scheduled events.

## How Qloo and the agent divide the work

| | Qloo | The agent (this repo, deterministic) |
|---|---|---|
| Understands | Taste: how places relate to the user's interests; which tags/entities exist | The user's words, limits and feedback |
| Provides | Place records (name, address, price level, website, tags, ambience, noise, time-of-day fit), per-result `affinity`, per-pick `explainability` | Nothing it invents: it only filters, ranks, assigns and words what Qloo returned |
| Decides | Which places match a taste signal in an area | Which of them are on-category, inside the user's limits, varied, and fit each stage; how to revise after feedback |

Qloo endpoints used (hackathon environment, `X-Api-Key`):

- `GET /search`: resolve a named interest (an author, an artist...) to a Qloo entity; several equal matches are shown for the user to choose.
- `GET /v2/tags`: resolve an interest to a Qloo tag.
- `GET /v2/insights` (`filter.type=urn:entity:place`): one request per category with `filter.tags` (category), `filter.location` + `filter.location.radius` (area), the user's other picks as `signal.interests.tags` / `signal.interests.entities`, `feature.explainability`, `filter.price_level.max`, `filter.exclude.entities`.

### Why it is an agent, not a single call

A bounded, observable tool-use loop (each step is streamed to the UI as it finishes):
**resolve interests** (preference / alias / `/v2/tags` / `/search`) → **query places** (`/v2/insights`, one per category, using the user's other
picks as taste signals) → **apply limits** (noise filter on Qloo's own `primary_genre`, then radius, price ceiling, exclusions, quiet) →
**construct** (documented fit score, diversity across categories, three stages) → **explain** (words only from Qloo's fields) →
**revise** (feedback becomes a concrete constraint; Qloo is re-queried only if the cached pool has no alternate). No LLM is used and
none is needed to pass any gate; an optional, off-by-default wording hook rejects any text that adds a number, odds or link.
Details: [docs/PLANNER.md](docs/PLANNER.md).

## A redacted request-to-result example

The same persona, changed in one interest and two limits. Real runs on the hackathon environment; place names, ids and other Qloo
records are deliberately omitted (the Qloo guide asks that response data not be published in a public repo).

**Scenario 1: baseline.** Interests: *indie bookstores, Korean food, coffee shops, quiet mornings*; Raleigh, 15 km; no budget.

```
GET /v2/insights
  filter.type=urn:entity:place
  filter.location=POINT(-78.6382 35.7796)          # downtown Raleigh
  filter.location.radius=15000
  filter.tags=urn:tag:category:place:cafe          # repeated for book_store, restaurant (here: the Korean cuisine tag), museum
  signal.interests.tags=urn:tag:category:place:book_store,urn:tag:genre:place:restaurant:korean   # the user's *other* picks
  take=30
X-Api-Key: <redacted>

→ 60 candidates across 4 categories → 39 on-category and inside the limits → 9 places, 3 per stage
  each card: <place name> · <category> · "<x.x> km from downtown Raleigh"
  why: "Qloo ranked it using your picks: “indie bookstores” and “Korean food”. Qloo tags it: <ambience/noise/time-of-day tags>."
  mix: café 3 · bookstore 2 · museum 2 · Korean restaurant 2
```

**Scenario 2: changed.** "Korean food" → "art museums", distance 7.5 km, dining budget ≤ $$.

```
  signal.interests.tags=...book_store,...museum    # the signals changed
  filter.location.radius=7500
  filter.price_level.max=2                         # cafés and restaurants only; unpriced bookstores/museums are kept and marked

→ 5 of the 9 places are different; mix: café 3 · museum 3 · bookstore 2 · Korean restaurant 1
  places with no price show "Price not available — check current details."
```

**Scenario 3: a named interest.** Adding *Haruki Murakami* returns four same-name entities from `/search`; after the user picks the author, every
card carries Qloo's attribution: *"Your pick “Haruki Murakami” contributed to how Qloo ranked it."*

**Scenario 4: feedback.** *Too expensive* on a $$ café sets a $ ceiling and swaps in a cheaper café in the same stage while saved items stay put;
*Too far* halves the distance limit; *Too lively* excludes places Qloo tags loud or lively; *Not interested* excludes the place and shows fewer of its kind.
If nothing qualifies the app says so and changes nothing.

## What the app will and will not say

Plan §4 is enforced in code and tests: no invented places, hours, prices, ratings, events, scores or promises; affinity is never shown as a
percentage; "affinity" is a ranking signal, not a prediction; hours/prices/availability are always labelled *"Check current hours, prices, and details before visiting."*;
a link appears only if Qloo returned a website; a place photo appears only if a source provides one the server could verify, and carries a modest credit ("Image via Qloo", "Image from the venue’s website", "Photo: Wikimedia Commons"). Otherwise the card keeps its category tile. No stock photos, ever.

## Run it locally

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
cp .env.example .env.local      # then set QLOO_API_KEY (and SESSION_SECRET, see below)
pnpm dev                        # http://localhost:3000  ("Try a sample plan" prefills the demo persona)
```

| Variable | Required | Purpose |
|---|---|---|
| `QLOO_API_KEY` | yes | Event-issued Qloo key. Server-side only; never `NEXT_PUBLIC_`; never committed. |
| `SESSION_SECRET` | recommended | ≥ 16 chars. Signs plan sessions so tampered ones are rejected. If unset, a signing key is derived from `QLOO_API_KEY`. `openssl rand -hex 32` |
| `GEOCODER_BASE_URL` | no | Place-search service for the Location step. Default `https://photon.komoot.io` (Photon, OpenStreetMap data, no key). Needs no secret. |
| `QLOO_BASE_URL` | no | Default `https://hackathon.api.qloo.com`. (`http://127.0.0.1:…` is allowed only for the local test mock.) |
| `DIAGNOSTICS_ENABLED` | no | `true` exposes `/api/diagnostics/*` in production. Leave unset. They are always on in development. |
| `RATE_LIMIT_*`, `MAX_CONCURRENT_BUILDS`, `QLOO_CACHE_TTL_SECONDS`, `GEOCODER_CACHE_TTL_SECONDS` | no | Usage protection and cache tuning, see `.env.example`. |

> **Hackathon credentials expire after judging.** Running this project afterwards needs a new, authorized Qloo API key (and, as the
> hackathon key is not valid on staging/production hosts, possibly a different `QLOO_BASE_URL`).

## Quality gates

| Command | What it checks |
|---|---|
| `pnpm typecheck` · `pnpm lint` | strict TypeScript; ESLint |
| `pnpm test` | unit tests (Vitest): client, validation, noise filter, planner, explanations, revision, signing, throttling |
| `pnpm e2e` | production build + Playwright on desktop (1280×800, 1440×900) and phone (375×812) against a **local mock of Qloo** (synthetic data): primary flow, real map and place search (with search-down and tiles-blocked fallbacks), save/replace/undo, refresh persistence, 429, outage, empty data, no key (503), throttling, tampered sessions, grounding and wording audits, axe WCAG 2.2 AA scan of every screen |
| `pnpm audit:secrets` | the key is not in git history, tracked files, or the client bundle; no env files or bulk data tracked |
| `pnpm audit:live` | with a running app and a real key: rebuilds the plan, repeats the Qloo request, and checks every place's name, address, price level, website, distance and tags against Qloo's fresh response |

## Architecture

```
Browser (React, no accounts; answers + plan kept in localStorage)
  ├─ map tiles: OpenFreeMap (MapLibre GL, loaded by the browser)
  └─ /api/plan  (build: NDJSON step stream · revise)   /api/interests (resolve one interest)   /api/geocode (place search → Photon)
        │   per-visitor + global throttling · input validation · HMAC-signed sessions
        ▼
  src/lib/agent   workflow → pipeline → relevance → constraints → scoring → planner → explain → revise → rubric
  src/lib/qloo    client (timeouts, bounded retry, no retry on 429) · schemas · normalizer · cache · interest resolver
        ▼
  Qloo API  (/search · /v2/tags · /v2/insights)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PLANNER.md](docs/PLANNER.md) (scoring formula, constraints, revision table).

**Map and place search.** The Location step shows a real map ([MapLibre GL](https://maplibre.org) with free [OpenFreeMap](https://openfreemap.org) tiles, no key) with a pin
and a circle for the distance limit. Typing in the search box finds places in the Raleigh area through [Photon](https://photon.komoot.io) (OpenStreetMap data). A searched place becomes
the search center for the plan, exactly like one of the curated neighborhoods; the curated list stays selectable and is the fallback when search or the map is unavailable.
Qloo supplies neither map tiles nor geocoding; it still supplies every place in the plan.

**Place photos.** After a plan is built (and after each revision), the server checks one image per place, in this order, and keeps only an image it saw answer as a real picture (`image/*`, under 5 MB, within 2 s): 1) the image URL Qloo returned (`properties.image.url`); 2) the page preview image (`og:image` / `twitter:image`) of the venue website Qloo returned, or for museums a Wikimedia Commons file within 150 m whose title or description names the venue; 3) nothing. The only URLs the server ever fetches are ones Qloo returned (or an image found on that page): http(s) only, ports 80/443, no credentials, never a loopback/private/link-local address (checked on every redirect and against DNS), HTML read capped at 256 KB, 1.5 s timeouts, results cached in memory. The chosen URL is part of the HMAC-signed session, so it cannot be swapped. In the browser the photo is a plain `<img loading="lazy" referrerpolicy="no-referrer">`; if it fails to load, the card falls back to the tile, so a broken-image icon never shows. The Content Security Policy allows images from any `https:` host for this reason.

**Privacy:** place search is proxied by our server, so the browser never sends what you type, or your address, to the geocoder; the server forwards only the query text and the
fixed Raleigh bounding box, caches answers in memory, and stores nothing. The map tiles and the place photos are the third parties your browser contacts directly (tile requests to `tiles.openfreemap.org`
reveal your IP address and the map area you view, as any map does). Place photos work the same way: your browser loads each photo directly from the host that serves it (Qloo's image host, a venue's site, or Wikimedia), which sees your IP address but no referrer, cookies or account. No accounts, cookies or analytics; answers and plan stay in your browser's localStorage. Map data © OpenStreetMap contributors.

**Security and usage protection:** the key stays on the server; sessions round-trip through the browser but are HMAC-signed (editing a place, price or wording
is rejected with `400`); per-visitor and global request limits, a concurrent-build cap, request pacing and an in-memory response cache keep a public link from exhausting the
event key; diagnostics routes return `404` in production. Responses carry a Content Security Policy (own origin plus the tile host only, `frame-ancestors 'none'`), `nosniff` and a strict referrer policy.

## Known limitations

- **Raleigh only**, four categories (cafés, bookstores, restaurants, museums & cultural venues). Restaurants follow the cuisine you name ("Japanese food", "Korean food", "Ethiopian food"...): the first cuisine interest sets the cuisine for the plan; with none named, restaurants in general. Climbing and other categories had no coverage in the hackathon data. Cuisine matching relies on Qloo's restaurant-style tags and each place's primary genre; Qloo sometimes tags a place with a cuisine it does not serve, so places whose genre names another cuisine are dropped.
- Qloo's data is partial: **no price for museums and most bookstores** (shown as unknown, never guessed); hours exist but are not displayed; atmosphere tags are missing for some places (the card says so). Ratings and phone numbers are not shown. Photos: Qloo returns an image URL for every place in the Raleigh data we checked, but the image is a venue photo of unknown provenance and may be out of date; a few URLs do not load, and for those the server tries the venue website's own preview image, then (museums only) a Wikimedia Commons file that names the venue, and otherwise shows the tile.
- "Indie" cannot be verified from Qloo's data; the app never claims a shop is independent (it ranks a few national chains lower when you ask for indie, by name).
- Curated neighborhood centers are approximate hand-entered coordinates, and their blurbs are illustrative; a searched place uses the geocoder's point. Distances are straight-line from the center, not travel time. Place search is limited to the Raleigh area (a fixed bounding box) and uses a free public geocoder with fair-use limits (cached, throttled); if it or the tile server is down, the flow falls back to the curated areas and an illustration.
- The Content Security Policy allows inline scripts (Next.js emits them; a per-request nonce would make every page dynamic).
- Usage limits and the response cache are per server instance (in memory); the signing secret is shared across instances.
- The planner is deterministic. No language model is used; the optional wording hook is off.
- Suggestions are ideas, not events: nothing is booked, scheduled or confirmed.

## Post-hackathon

Ideas deliberately out of scope for this submission: more cities and categories; several cuisines in one plan; apartment/neighborhood
comparison; opening hours and live availability; saving plans to an account or exporting to a calendar; an LLM wording layer (the guard is already in place);
travel-time based distances; user-to-user or community features.

## License

[MIT](LICENSE)
