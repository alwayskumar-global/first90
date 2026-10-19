# Deployment

First 90 Days is a standard Next.js app; the steps below deploy it to Vercel with no database and no accounts for visitors.

## Deploy to Vercel

1. Create a Vercel project from this repository (Import Git Repository). Framework: Next.js (auto). Node: 22 or later. Do not override the build command: `pnpm build` also copies the map worker into `public/maplibre/` (see `scripts/copy-maplibre-worker.mjs`).
2. **Environment variables → Production** (and Preview, if previews are used):
   - `QLOO_API_KEY`: your Qloo key *(Sensitive)*. Server-side only; never prefix it with `NEXT_PUBLIC_`.
   - `SESSION_SECRET`: output of `openssl rand -hex 32` *(Sensitive)*. Keep the same value on every deployment so signed sessions stay valid across instances and redeploys.
   - Leave **unset**: `DIAGNOSTICS_ENABLED`, `QLOO_BASE_URL` (the default is correct for the hackathon environment), `IMAGE_VERIFY`, `IMAGE_ALLOW_LOOPBACK` (test-only switches). Optional: `GEOCODER_BASE_URL` (default Photon; needs no key).
   - Optional tuning (defaults are fine): `RATE_LIMIT_*`, `MAX_CONCURRENT_BUILDS`, `QLOO_CACHE_TTL_SECONDS`, `GEOCODER_CACHE_TTL_SECONDS`. See `.env.example`.
3. Deploy. Under **Settings → Deployment Protection**, make sure the **Production** URL is publicly accessible if visitors should need no login.
4. Smoke test the production URL in a private window and on a phone:
   - Welcome → **Try a sample plan** → **Build my plan** → three stages with places and photos.
   - Save one place, Replace another (**Too far**), **Undo**, refresh the page.
   - `https://<url>/api/diagnostics/plan?scenarios=1` must return **404**.
5. Optional grounding audit against production (uses your key locally, about 5 Qloo requests):
   `QLOO_API_KEY=… node scripts/live-audit.mjs https://<url>` → expect `LIVE AUDIT PASSED`.

Notes:
- Usage limits and the in-memory caches are per serverless instance, so the global cap bounds each instance, not the whole fleet.
- Hackathon Qloo keys stop working after the judging period; running the app afterwards needs a new, authorized key (and possibly a different `QLOO_BASE_URL`).

## Before publishing a fork or a change

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e && pnpm audit:secrets` should all pass. `pnpm audit:secrets` checks that the key is not in git history, tracked files or the client bundle, and that no `.env` files or bulk data are tracked.
