# Solid: what the WasmGC builds change

Versions: solid-js 1.9.20 and babel-preset-solid 1.9.19 (dom-expressions 0.40), with @babel/core 7.29.16. solid-js 2.0.4 is the npm `latest`, but no stable compiler preset targets it yet: babel-preset-solid's stable 1.9.19 peers solid-js ^1.9, and its 2.x line is a release candidate.

## The published lane

`out/solid.bundle.js` is the JavaScript lane's own bundle, unminified, compiled as it is. It has no changes.

## The typed port (`port/`)

`port/solid-js.ts` and `port/web.ts` are Solid's runtime in TypeScript: the part of `solid-js/dist/solid.js` and `solid-js/web/dist/web.js` that this program reaches (esbuild's tree-shaken set, about 1,000 lines), with its nodes as typed classes. `port/dom-page.ts` and `port/dom-stream.ts` are its DOM, one per lane. The behavior is the published code's, except where listed here.

- **Left out, because this program never reaches them:** transitions, Suspense, the Scheduler, external sources, hydration (`sharedConfig`), dev mode, `For`'s fallback and its index signal, and the error-boundary context (an error is rethrown as is, where Solid wraps a non-Error in one).
- **Signals and memos use Solid's default comparator** (`===`), written inline. A setter takes a value, not an updater function, since this program passes values only.
- **Nodes are typed classes.** `SourceNode` is a signal or memo's observer list, `Owner` a scope, and `Computation` an effect, memo or pure computation. `updatedAt` uses -1 for Solid's null. A memo is marked by a flag where Solid tests `"observers" in node`.
- **`createRoot` always makes an owned root.** Solid makes an unowned root for a function that declares no parameter (`fn.length === 0`), and every caller here takes the disposer.
- **An effect's value is `unknown`.** Solid's is generic.
- **`For`'s props declare `each` as a getter,** which is what babel-preset-solid writes for a reactive expression (`get each() { return rows(); }`). A data property would read it once.
- **Delegated handlers.** In the per-call DOM they sit on the page node as `$$<name>`, as Solid keeps them. On the stream they sit in a slot of the bridge's node. The dispatcher walks from the target up to the document, calls each handler, and stops when one cancels the bubble. It does not retarget `event.target` or `currentTarget` (no handler here reads them), and on the stream it skips Solid's `disabled` test, since this program disables nothing.
- **`render` adopts its mount point** (`MountableElement` is a page element in both lanes). Its disposer releases the mount point from the bridge and flushes.

## Stream rules (`port/dom-stream.ts`)

- **The flush point.** Solid writes the DOM synchronously, inside an update (`runUpdates`) or an event handler. The stream is flushed at the end of the outermost update, unless a delegated event is being dispatched, and at the end of every delegated dispatch. No page code runs between those points, so the page is exact whenever it can be observed.
- **Text.** `textContent = text` makes its text node on the compiled side, so the mirror knows it and later writes update its data in place.
- **Release.** A node Solid's DOM code removes (`remove`, a replaced child, `textContent`) is released from both node tables, since Solid's own DOM code never inserts a removed node again in this program. A program that keeps a node to insert it again would need to keep it.

## The app's JSX (`build-js.mjs`, `solidTypedOutput`)

The preset's output stays TypeScript (Babel parses the types and the preset leaves them in place). Three rewrites make it type-correct against the typed runtime, each equivalent to what the published runtime does:

- **`el.$$click = h` becomes `addEventListener(el, "click", h, true)`.** That is dom-expressions' own function with delegation on, which makes the same property write.
- **`var _el$2 = _el$.firstChild` asserts a non-null node** (`!`). The template guarantees it.
- **`createComponent(C, props)` becomes `untrack(() => C(props))`,** which is how `createComponent` is defined. This lets a generic component (`For`) be instantiated from its props.

The app annotates `For`'s row parameter (`(row: Row) => ...`) and declares `Label`'s reactive prop as a getter (`get n(): number`), as noted in `app/app.tsx`.
