#!/usr/bin/env bash
# Secret and bulk-data audit. Never prints a secret value; reports pass/fail only.
#   1. the Qloo key / session secret appear nowhere in git history, tracked files, or the production client bundle
#   2. no env or private-plan files are tracked
#   3. no bulk Qloo data (large JSON, entity-id dumps) is tracked
# Run after `pnpm build`. Reads QLOO_API_KEY / SESSION_SECRET from the environment or .env.local.
set -u
cd "$(dirname "$0")/.."
fail=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=1; }

secret() { # name -> value (env first, then .env.local)
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f .env.local ]; then v=$(awk -F= -v k="$1" '$1==k{print substr($0,index($0,"=")+1)}' .env.local); fi
  printf '%s' "$v"
}

for name in QLOO_API_KEY SESSION_SECRET; do
  value=$(secret "$name")
  if [ -z "$value" ]; then echo "  skip $name not set here (nothing to search for)"; continue; fi
  echo "[$name]"
  if [ -n "$(git log --all -p -S"$value" --oneline 2>/dev/null | head -1)" ]; then bad "found in git history"; else ok "not in git history ($(git rev-list --all --count) commits)"; fi
  if git grep -qF -- "$value" -- . 2>/dev/null; then bad "found in a tracked file"; else ok "not in tracked files"; fi
  if [ -d .next/static ]; then
    if grep -rqF -- "$value" .next/static 2>/dev/null; then bad "found in the client bundle (.next/static)"; else ok "not in the client bundle ($(find .next/static -type f | wc -l | tr -d ' ') files)"; fi
  else echo "  skip .next/static missing (run pnpm build first)"; fi
  if [ -d .next/server ] && grep -rqF -- "$value" .next/server 2>/dev/null; then bad "found in the server build output"; else ok "not in the server build output"; fi
done

echo "[repository hygiene]"
tracked_secret_files=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '^\.env\.example$' || true)
[ -z "$tracked_secret_files" ] && ok "no .env files tracked (only .env.example)" || bad "env file tracked: $tracked_secret_files"
git ls-files | grep -qiE 'PROJECT_PLAN' && bad "private project plan is tracked" || ok "project plan not tracked"
git check-ignore -q .env.local && ok ".env.local is git-ignored" || bad ".env.local is not ignored"
grep -rqE 'process\.env\.NEXT_PUBLIC_|^[^#]*NEXT_PUBLIC_[A-Z_]+=' src .env.example 2>/dev/null && bad "NEXT_PUBLIC_ variable present (would expose a value to the browser)" || ok "no NEXT_PUBLIC_ variables"

echo "[bulk data]"
big=$(git ls-files -z | xargs -0 -I{} sh -c 'test -f "{}" && [ "$(wc -c < "{}")" -gt 150000 ] && echo "{}"' | grep -v pnpm-lock.yaml || true)
[ -z "$big" ] && ok "no tracked file over 150 KB (excluding the lockfile)" || bad "large tracked file(s): $big"
# synthetic test ids use the reserved prefix 00000000-0000-4000-8000-; anything else UUID-shaped would be a real Qloo id
uuids=$(git grep -hoiE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' -- . ':!pnpm-lock.yaml' 2>/dev/null | grep -viE '^00000000-0000-4000-8000-' | sort -u | head -3 || true)
[ -z "$uuids" ] && ok "no real Qloo entity ids (UUIDs) in tracked files" || bad "UUID-shaped ids present (e.g. $(echo "$uuids" | head -1 | cut -c1-8)...)"
json_dumps=$(git ls-files | grep -E '\.json$' | grep -vE '^(package|tsconfig)\.json$' || true)
[ -z "$json_dumps" ] && ok "no data JSON files tracked" || bad "unexpected JSON files: $json_dumps"

if [ "$fail" -eq 0 ]; then echo "AUDIT PASSED"; else echo "AUDIT FAILED"; exit 1; fi
