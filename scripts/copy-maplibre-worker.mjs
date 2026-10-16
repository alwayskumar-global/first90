// MapLibre runs its tile parsing in a Web Worker. Bundlers cannot resolve the worker from inside the package,
// so copy the self-contained worker module to /public and point MapLibre at it (see src/screens/AreaMap.tsx).
// Run before `next dev` and `next build`; the copy is git-ignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(process.cwd(), "public", "maplibre");
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
