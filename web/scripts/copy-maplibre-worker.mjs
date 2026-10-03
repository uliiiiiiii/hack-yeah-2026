// Copy MapLibre's worker + its shared module into public/ so the browser can
// load the worker by a stable URL. Bundlers (Turbopack/webpack) don't reliably
// emit MapLibre's `new URL('./maplibre-gl-worker.mjs', import.meta.url)` worker,
// which otherwise 404s and leaves the map blank. We point setWorkerUrl() at
// these copies instead. Runs automatically via predev/prebuild.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url)); // web/scripts
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const outDir = join(root, "..", "public", "maplibre");
mkdirSync(outDir, { recursive: true });

for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, f), join(outDir, f));
  console.log("copied", f, "->", "public/maplibre/" + f);
}
