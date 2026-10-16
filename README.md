# First 90 Days

Helps a newcomer build a life in a new city, one fitting routine at a time. It turns a few stated interests
into a staged, revisable local discovery plan (First Week, First Month, Months 2-3) grounded in real
[Qloo](https://docs.qloo.com) place data. Built for the Qloo Agentic Hackathon.

> **Status: Milestone 1 (engineering foundation).** The Qloo client, interest resolver and place normalizer
> exist and are tested. There is no product UI yet; `/` is a placeholder.

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

## Live diagnostic (development)

With a key in `.env.local` and `pnpm dev` running:

```bash
curl 'localhost:3000/api/diagnostics/qloo?category=cafe'          # up to 5 normalized places
curl 'localhost:3000/api/diagnostics/qloo?interest=ramen'         # interest resolution
```

Categories: `cafe`, `bookstore`, `korean_restaurant`, `museum`. The response never contains the key.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data & key handling

- The Qloo key stays on the server. The repo contains no key and no bulk Qloo data; test fixtures are synthetic.
- Hackathon credentials expire after judging. Running this project afterwards needs a new, authorized Qloo key.

## License

[MIT](LICENSE)

## Post-hackathon ideas

_(none recorded yet)_
