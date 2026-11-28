// Bundles the app against published React (this package's pinned react and react-dom) as one ES module, and the same
// React as the page modules a WasmGC build against published React loads (out/react-modules.js).
// esbuild comes from the workspace (tsx's own dependency); nothing else is installed for it.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const esbuild = createRequire(createRequire(import.meta.url).resolve("tsx/package.json"))("esbuild");
const outfile = path.join(here, "out", "app.js");
await esbuild.build({
  entryPoints: [path.join(here, "app", "js-entry.ts")],
  bundle: true,
  format: "esm",
  minify: true,
  outfile,
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: [path.join(here, "node_modules")],
  logLevel: "warning",
});
console.log(`ok ${path.relative(process.cwd(), outfile)}`);
// The same React, as the page's npm modules for the WasmGC build against published React (build-wasm.mjs --published).
const modulesFile = path.join(here, "out", "react-modules.js");
await esbuild.build({
  entryPoints: [path.join(here, "app", "react-modules.ts")],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: modulesFile,
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: [path.join(here, "node_modules")],
  logLevel: "warning",
});
console.log(`ok ${path.relative(process.cwd(), modulesFile)}`);
