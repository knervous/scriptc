# Capability probes

Probes behind [`docs/capabilities.md`](../../docs/capabilities.md). They prove its findings; they are not part of the test suite and change no compiler behaviour.

```console
$ pnpm --filter @scriptc/compiler build
$ node tests/capabilities/build.mjs                 # probe modules into tests/capabilities/out/
$ node tests/capabilities/features.mjs tests/capabilities/out/*.wasm
$ node tests/capabilities/engine-probe.mjs
$ node tests/capabilities/node-stage.mjs tests/capabilities/out/basics.wasm native
$ node tests/capabilities/lane.mjs                  # every module under every strings mode, against expected.json
$ node tests/capabilities/chromium.mjs              # the browser lanes (--browser=firefox|webkit, --executable=<path>)
```

- `features.mjs`: the wasm features a module actually uses (the build's own wasm-opt re-validates it with each feature removed).
- `engine-probe.mjs`: exception-handling encodings and JS-API entry points this Node offers.
- `node-stage.mjs`: compile, instantiate and run one module, naming the failing stage; `polyfill` and `constants` modes run it without the engine's string support.
- `lane.mjs`: one CI lane. A module whose recorded requirements this engine meets must print exactly its golden output (`expected.json`) in every strings mode; one it does not meet must be refused, naming what is missing. `--update` rewrites the goldens from a capable engine.
- `chromium.mjs` and `web/`: the same in a headless browser, with and without cross-origin isolation and with JS-API entry points deleted, plus the task ring under `threads: "auto"` (`web/ring-script.js`, `web/ring-worker.js`), which must give one log whether it ran threaded or not.

`out/` is build output and is not committed.
