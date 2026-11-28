// Bundles each scene app as JavaScript (out/<lib>.js, exporting setup and frame) and each library as the page's npm
// modules for a WasmGC build that leaves it as JavaScript (out/<lib>-modules.js, exporting `modules`, the loader's
// option). esbuild comes from the workspace (tsx's own dependency).
//
//   node benchmarks/3d/build-js.mjs [three|lite|core ...]
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(createRequire(import.meta.url).resolve("tsx/package.json"))("esbuild");
const libs = process.argv.slice(2).length ? process.argv.slice(2) : ["three", "lite", "core"].filter((l) => fs.existsSync(path.join(here, l, "app.ts")));
for (const lib of libs) {
  for (const [entry, out] of [["app.ts", `${lib}.js`], ["modules.ts", `${lib}-modules.js`]]) {
    if (!fs.existsSync(path.join(here, lib, entry))) continue;
    await esbuild.build({
      entryPoints: [path.join(here, lib, entry)], bundle: true, format: "esm", minify: true, outfile: path.join(here, "out", out),
      define: { "process.env.NODE_ENV": '"production"' }, nodePaths: [path.join(here, "node_modules")], logLevel: "warning",
    });
    console.log(`ok out/${out}`);
  }
}
