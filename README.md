# First 90 Days

Helps a newcomer build a life in a new city, one fitting routine at a time. It turns a few stated interests
into a staged, revisable local discovery plan (First Week, First Month, Months 2-3) grounded in real
[Qloo](https://docs.qloo.com) place data. Built for the Qloo Agentic Hackathon.

> **Status: Milestone 3 (UI implementation), awaiting design-fidelity review.** The eight screens from the supplied
> design (Welcome, Location, Interests, Preferences, Building, Plan, Place details, Replace) run on the real
> plan engine and live Qloo data. See [docs/UI_IMPLEMENTATION_NOTES.md](docs/UI_IMPLEMENTATION_NOTES.md) for how the
> design maps to the product and where it was adapted, [docs/PLANNER.md](docs/PLANNER.md) for the engine.

## Demo scope

Raleigh, NC; categories: cafes, bookstores, Korean restaurants, museums & cultural venues.
Chosen from live coverage checks on the hackathon environment. Plan items are *suggested activities*, not
scheduled events. Hours, prices and links are shown only when Qloo returns them and are labeled
"check current details".

## Setup

Requires Node >= 22 and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then edit .env.local and set QLOO_API_KEY
pnpm dev
```

| Variable | Required | Notes |
|---|---|---|
| `QLOO_API_KEY` | yes (for live calls) | Event-issued key. **Server-side only**; never prefix with `NEXT_PUBLIC_`, never commit it. |
| `QLOO_BASE_URL` | no | Defaults to `https://hackathon.api.qloo.com`. Hackathon keys do not work on the staging or production hosts. |
| `DIAGNOSTICS_ENABLED` | no | `true` enables `/api/diagnostics/qloo` in production. It is always on in development. |

`pnpm build` and CI need no key; the key is read at request time only.

## Scripts

| Command | What it does |
|---|---|
| `pnpm typecheck` | Generates Next route types, then `tsc --noEmit` (strict) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (no network; the Qloo client is tested with a fake `fetch`) |
| `pnpm build` | Production build |
| `pnpm check` | All of the above |

## Using the app

`pnpm dev`, open http://localhost:3000. The flow is Welcome -> Location -> Interests -> Preferences -> Building -> Plan.
"Try a sample plan" prefills the demo persona. Everything stays in this browser (no accounts); "Start over" on the
plan page clears it. Public API routes (`/api/plan`, `/api/interests`) are server-side, throttled per visitor, and never
return the Qloo key.

## Live diagnostic (development)

With a key in `.env.local` and `pnpm dev` running:

```bash
curl 'localhost:3000/api/diagnostics/qloo?category=cafe'          # up to 5 normalized places
curl 'localhost:3000/api/diagnostics/qloo?interest=ramen'         # interest resolution
```

Categories: `cafe`, `bookstore`, `korean_restaurant`, `museum`. The response never contains the key.

Plan engine (also development-only; add `DIAGNOSTICS_ENABLED=true` to expose it in production):

```bash
# Runs the live demo scenarios (baseline, changed interests/limits, feedback revisions, entity interest)
# and returns a rubric report. ~30 paced Qloo requests; run it sparingly.
curl 'localhost:3000/api/diagnostics/plan?scenarios=1'

# Build a plan, then revise it
curl -X POST localhost:3000/api/diagnostics/plan -H 'content-type: application/json' \
  -d '{"action":"build","input":{"interests":["indie bookstores","Korean food","coffee shops","quiet mornings"],"areaKey":"raleigh-nc","radiusMeters":15000,"categories":["cafe","bookstore","korean_restaurant","museum"],"atmosphere":"no_preference","preferMornings":false}}'
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data & key handling

- The Qloo key stays on the server. The repo contains no key and no bulk Qloo data; test fixtures are synthetic.
- Hackathon credentials expire after judging. Running this project afterwards needs a new, authorized Qloo key.

## License

[MIT](LICENSE)

## Post-hackathon ideas

_(none recorded yet)_
