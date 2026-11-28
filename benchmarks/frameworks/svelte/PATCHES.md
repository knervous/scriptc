# Svelte 5: what the WasmGC builds change

Version: svelte 5.59.2. The app is written with runes (`$state`, `$state.raw`, `$props`, snippets). The Svelte compiler compiles it (`generate: "client"`), as Vite's plugin would, and the a11y warnings that an `<a>` with a click handler draws are filtered out.

## The published lane

`out/svelte.bundle.js` is the JavaScript lane's own bundle (Svelte's published `src/` and the compiled components), unminified, compiled as it is. It has no changes.

## The stream lane (`stream/`)

The components are compiled with Svelte's custom-renderer option (`experimental.customRenderer`) for `stream/renderer.ts`, a `Renderer` whose nodes are the DOM stream's compiled nodes. The runtime is Svelte's published one, bundled. These are the changes:

- **Templates clone in one command.** For a custom renderer, Svelte's `from_tree` builds every node of every clone one renderer call at a time, rather than cloning a template. The patch (`build-js.mjs`, `SVELTE_STREAM_PATCHES`, in `internal/client/dom/template.js`) makes it ask the renderer instead when the renderer has `parseTree` and `cloneTree`: parse the structure once, then clone it in one call. Renderers without those methods behave as before. `renderer.ts` turns the structure into HTML for the page to parse once (host:dom `template`) and clones it with `cloneTemplate`.
- **Array holes in the compiled components become `undefined`.** A template structure marks a comment with a hole (`[a, , b]`). The WasmGC compiler has no holes yet, and Svelte reads the structure with `for...of` and tests `item === undefined`, which a hole and `undefined` answer the same way.
- **Events are delegated by the renderer.** With a custom renderer, Svelte gives every element its own listener and calls the handler directly. `renderer.ts` keeps each handler in a slot of its node and registers one page listener per event type on the document. It walks from the target up and stops when a handler cancels the bubble: the order and stopping point that bubbling through per-element listeners would give.
- **Attributes** are read from the page (`getAttribute`, `hasAttribute`, which flush first). Svelte reads them only off the hot paths.
- **The entry** (`stream/main.svelte.ts`) mounts with `{ target, renderer }` into adopted page elements and settles (see below) before every page read. The app itself (`app/App.svelte`, `app/Label.svelte`, `app/rows.svelte.ts`) is the same as in the JavaScript lane.

### Stream rules

- **The flush point.** Svelte writes the DOM when it flushes its batch, in a microtask after a change. Each delegated event queues one microtask that runs Svelte's `flushSync` and then flushes the stream, and the entry does the same after each change it makes. So the page is exact once Svelte has nothing pending, which is before any page code can observe it.
- **Release.** A node Svelte removes leaves both node tables at the next flush point, if it is still detached then. Svelte inserts some removed nodes again at once, such as an each block's anchor after a clear, so it is not released on removal.

## The JSDoc-typed build (tried, `build-wasm.mjs svelte jsdoc`)

This compiles Svelte's published `src/` unbundled, with `checkJs`, so its JSDoc types reach the compiler. esm-env's flags are fixed to the production browser's. Two edits to the staged copy:

- **`internal/client/dom/reconciler.js`:** no Trusted Types policy. In Chromium the policy's `createHTML` answers a TrustedHTML object, which the JSDoc cast calls a string, and the compiler checks that cast. This only matters on pages that enforce Trusted Types.
- **`internal/client/dom/operations.js`:** `child`'s `is_text` is optional in its JSDoc, as `first_child`'s is. The compiled components omit it.

It builds and mounts the app. Its cycle step still fails (`proxy.js` declares a generic arrow function inside a function, which the compiler does not support yet), and create1k does not finish, so it was set aside (RESULTS.md).
