# React table benchmark

A program in the style of js-framework-benchmark, written once (`app/app.ts`) and run two ways in headless Chromium: as JavaScript on published React 19.2.8 (this package's pinned dev dependencies), and compiled to WasmGC. The runner reports each operation's median and p95 per lane, and each WasmGC lane's ratio to JavaScript.

The operations are clicks on the app's buttons and row links, so each runs through React's root event delegation:
- create 1,000 rows (`create1k`), and replace them (`replace1k`);
- update every 10th row (`update10th`);
- select a row (`select`);
- swap two rows (`swap`);
- remove a row (`remove`);
- create 10,000 rows (`create10k`);
- append 1,000 rows (`append1k`);
- clear (`clear`);
- one mount, update and unmount of a small tree (`cycle`), timed over batches of five.

## Method

- Every sample runs on a fresh page per operation, lane and round, and the lanes' order rotates by round.
- Each page runs warmup samples first (untimed), then the timed ones. Create 10,000 rows takes a third of the samples.
- An operation's script time runs from the click to the end of React's commit, which a mutation observer's callback marks. Layout is timed separately, by forcing it right after; both lanes pay it.
- After every sample the page checks the result (row counts, the selected row, the swapped and removed rows), and the runner compares a fingerprint of the table between lanes.
- The pages are served cross-origin isolated, so `performance.now()` has its fine resolution.
- `--count` loads each WasmGC lane once with its host imports counted, and prints the calls per operation. Timings from that run are not reported.

## Running

```console
$ npm install --prefix benchmarks/react-dom
$ node benchmarks/react-dom/build-js.mjs
$ node benchmarks/react-dom/run.mjs --wasm <app.wasm> [--pages 3] [--warmup 5] [--iterations 10] [--ops create1k,select] [--receipt name]
$ node benchmarks/react-dom/run.mjs --wasm <app.wasm> --count
$ node benchmarks/react-dom/run.mjs --bridge <app.wasm> [--bridge <other.wasm>]
$ node benchmarks/react-dom/profile.mjs --wasm <app.wasm> --query bridge=/packages/dom-stream/src/dom-host.js --ops create1k --top 20
```

`--bridge` runs a build whose DOM goes through the DOM stream (`packages/dom-stream`), with the stream's page half loaded next to the host. `profile.mjs` splits each operation's script time between compiled code, the host's JavaScript, the DOM natives it calls, the page and the garbage collector; a release build keeps its function names for `--top` when built with `SCRIPTC_WASMGC_NAMED=1`.

The WasmGC module exports `mount(id)` and `cycle()`, as `app/js-entry.ts` does for JavaScript. `build-wasm.mjs` builds it from `app/app.ts` (through `wasm/entry.ts`) against `packages/react-ts`, React's client packages in strict TypeScript, with React DOM on the DOM stream (`packages/react-ts/PATCHES.md`), and `browser: true`: `node benchmarks/react-dom/build-wasm.mjs [out.wasm]`, then `run.mjs --bridge benchmarks/react-dom/out/app.wasm`. `--receipt` writes the results to `receipts/<name>.json`.
