# Deployment and publication checklist

Nothing here has been run. Rule 8: the repository stays private and nothing is submitted until Kumar says so.

## A. Deploy to Vercel (account-free public demo)

1. Create a Vercel project from `alwayskumar-global/first90` (Import Git Repository). Framework: Next.js (auto). Node: 22 or later. No build command overrides.
2. **Environment variables → Production** (and Preview if previews will be used):
   - `QLOO_API_KEY` = the event key *(Sensitive)*.
   - `SESSION_SECRET` = output of `openssl rand -hex 32` *(Sensitive)*. Keep the same value on every deployment so signed sessions stay valid across instances and redeploys.
   - Leave **unset**: `DIAGNOSTICS_ENABLED`, `QLOO_BASE_URL` (default is correct). Optional: `GEOCODER_BASE_URL` (default Photon; no key needed, no new secret for CR-007).
   - Optional tuning (defaults are fine): `RATE_LIMIT_BUILDS_PER_MIN`, `RATE_LIMIT_GLOBAL_BUILDS_PER_MIN`, `MAX_CONCURRENT_BUILDS`, `QLOO_CACHE_TTL_SECONDS`. See `.env.example`.
3. Deploy. In **Settings → Deployment Protection**, make sure the **Production** URL is publicly accessible (no Vercel Authentication / password) so judges need no login.
4. Smoke test the production URL in a private window and on a phone:
   - Welcome → **Try a sample plan** → **Build my plan** → three stages with places.
   - Save one place, Replace another (**Too far**), **Undo**, refresh the page.
   - `https://<url>/api/diagnostics/plan?scenarios=1` must return **404**.
5. Optional live grounding audit against production (uses your local key, about 5 Qloo requests):
   `QLOO_API_KEY=… node scripts/live-audit.mjs https://<url>` → expect `LIVE AUDIT PASSED`.
6. Add the production domain to the README ("Live demo") and your local `docs/DEVPOST_SUBMISSION.md` (git-ignored); commit the README change.
7. Judging window: Qloo keeps hackathon keys active through the judging period (to **16 November 2026**) and deactivates them afterwards; keep the deployment up until then. After that the demo needs a new authorized key.

Notes: usage limits and the Qloo response cache are per serverless instance; the global cap therefore bounds each instance, not the whole fleet. For a judging-scale audience this is ample; raise the limits only if Qloo raises the key's quota.

## B. Make the repository public

Do this only after Kumar's go-ahead, and after A if the live URL should appear in the About box.

1. Final pre-flight on `main`: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm audit:secrets` and `pnpm e2e` all pass; CI is green.
2. Confirm nothing private is tracked: `git ls-files | grep -iE "PROJECT_PLAN|\.env"` shows only `.env.example`; `docs/PROJECT_PLAN.md` is git-ignored.
3. Make it public and set the About box (one command, or Settings → General → Danger Zone → Change visibility):
   ```bash
   gh repo edit alwayskumar-global/first90 \
     --visibility public --accept-visibility-change-consequences \
     --description "First 90 Days: a staged, revisable local discovery plan for newcomers, grounded in real Qloo place data (Qloo Agentic Hackathon)." \
     --homepage "https://<production-url>" \
     --add-topic qloo --add-topic nextjs --add-topic typescript --add-topic hackathon
   ```
4. Confirm the license is detected and visible in the right-hand **About** panel: `gh repo view alwayskumar-global/first90 --json licenseInfo` → `MIT License`. (The `LICENSE` file at the repo root is what GitHub reads; Devpost requires it to be visible there.)
5. Open the repo in a private window: README renders, no secrets in any file, Actions tab green.
6. Copy the public repo URL and the live URL into the Devpost form from your local `docs/DEVPOST_SUBMISSION.md` (git-ignored); take the screenshots from the deployed site; submit only on Kumar's instruction before **30 October 2026, 11:45 PM EDT** (31 Oct, 9:15 AM IST).
